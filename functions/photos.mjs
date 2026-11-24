import { authed, json } from "./_lib.mjs";
import { getStore } from "@netlify/blobs";

const TOKEN = process.env.ICLOUD_ALBUM_TOKEN;
const PICK_COUNT = 5;
const URL_TTL = 55 * 60_000; // refresh URLs before Apple's ~1h expiry

let urlCache = null, urlCacheTime = 0;

// iCloud shared streams API — handles Apple's non-standard 330 redirect
async function icloudPost(path, body) {
  let host = "p23-sharedstreams.icloud.com";
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "https://www.icloud.com" },
      body: JSON.stringify(body)
    });
    if (r.status === 330) {
      const d = await r.json();
      host = d["X-Apple-MoveToStream"] || host;
      continue;
    }
    if (!r.ok) throw new Error(`iCloud ${path} → ${r.status}`);
    return r.json();
  }
  throw new Error("iCloud redirect loop");
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

// Deterministic LCG pick seeded by date string
function seededPick(arr, count, seed) {
  const copy = [...arr];
  const result = [];
  let s = parseInt(seed.replace(/-/g, ""), 10) % 1_000_000_000;
  for (let i = 0; i < count && copy.length; i++) {
    s = (s * 1_664_525 + 1_013_904_223) & 0x7fffffff;
    result.push(copy.splice(s % copy.length, 1)[0]);
  }
  return result;
}

// Pick the best derivative under 2 MB by file size
function bestChecksum(photo) {
  return Object.values(photo.derivatives || {})
    .filter((d) => d.checksum && +d.fileSize > 10_000 && +d.fileSize < 2_000_000)
    .sort((a, b) => +b.fileSize - +a.fileSize)[0]?.checksum ?? null;
}

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  if (!TOKEN) return json({ photos: [], noKey: true });
  if (urlCache && Date.now() - urlCacheTime < URL_TTL) return json(urlCache);

  try {
    const store = getStore("board");
    const today = todayStr();

    // Load today's selection from Blobs (GUID + checksum pairs), or compute fresh
    let sel = await store.get("photo_sel", { type: "json" }).catch(() => null);
    if (!sel || sel.date !== today) {
      const stream = await icloudPost(`/${TOKEN}/sharedstreams/webstream`, { streamCtag: null });
      const all = (stream.photos || []).filter((p) => !/video/i.test(p.mediaAssetType || ""));
      if (!all.length) throw new Error("album is empty");
      const picked = seededPick(all, PICK_COUNT, today);
      sel = { date: today, photos: picked.map((p) => ({ guid: p.photoGuid, checksum: bestChecksum(p) })) };
      await store.set("photo_sel", JSON.stringify(sel));
    }

    // Fetch fresh CDN URLs for today's 5 GUIDs
    const guids = sel.photos.map((p) => p.guid);
    const urlData = await icloudPost(`/${TOKEN}/sharedstreams/webasseturls`, { photoGuids: guids });

    const photos = sel.photos
      .map(({ guid, checksum }) => {
        if (!checksum) return null;
        return urlData.items?.[guid]?.derivatives?.[checksum]?.url ?? null;
      })
      .filter(Boolean);

    if (!photos.length) throw new Error("no URLs resolved");
    urlCache = { photos };
    urlCacheTime = Date.now();
    return json(urlCache);
  } catch (e) {
    if (urlCache) return json(urlCache); // serve stale on error
    return json({ photos: [], error: e.message });
  }
};
export const config = { path: "/api/photos" };
