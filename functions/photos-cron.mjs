import { getStore } from "@netlify/blobs";

// iCloud shared album webstream call takes ~50s — handled here by the scheduled
// function so the regular /api/photos function never waits more than ~2s.
async function icloudPost(path, body) {
  let host = "p23-sharedstreams.icloud.com";
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "https://www.icloud.com" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.status === 330) {
      const d = await r.json();
      host = d["X-Apple-MMe-Host"] || host;
      continue;
    }
    if (!r.ok) throw new Error(`iCloud ${path} → ${r.status}`);
    return r.json();
  }
  throw new Error("iCloud redirect loop");
}

function bestChecksum(photo) {
  return Object.values(photo.derivatives || {})
    .filter((d) => d.checksum && +d.fileSize > 10_000 && +d.fileSize < 2_000_000)
    .sort((a, b) => +b.fileSize - +a.fileSize)[0]?.checksum ?? null;
}

export default async () => {
  const TOKEN = process.env.ICLOUD_ALBUM_TOKEN;
  if (!TOKEN) { console.log("photos-cron: ICLOUD_ALBUM_TOKEN not set, skipping"); return; }

  try {
    console.log("photos-cron: fetching webstream…");
    const stream = await icloudPost(`/${TOKEN}/sharedstreams/webstream`, { streamCtag: null });
    const photos = (stream.photos || [])
      .filter((p) => !/video/i.test(p.mediaAssetType || ""))
      .map((p) => ({ guid: p.photoGuid, checksum: bestChecksum(p) }))
      .filter((p) => p.checksum);

    if (!photos.length) throw new Error("album is empty or all videos");

    const store = getStore("board");
    await store.set("photo_meta", JSON.stringify({ photos, updatedAt: Date.now() }));
    console.log(`photos-cron: saved ${photos.length} photos`);
  } catch (e) {
    console.error("photos-cron error:", e.message);
  }
};

export const config = { schedule: "0 */2 * * *" };
