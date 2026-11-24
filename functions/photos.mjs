import { authed, json } from "./_lib.mjs";
import { getStore } from "@netlify/blobs";

const URL_TTL = 55 * 60_000;
const PICK_COUNT = 5;

let urlCache = null, urlCacheTime = 0;

// iCloud shared streams API — handles Apple's non-standard 330 redirect.
// On 330 the body contains {"X-Apple-MMe-Host": "pXX-sharedstreams.icloud.com"}.
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
      host = d["X-Apple-MMe-Host"] || host;
      continue;
    }
    if (!r.ok) throw new Error(`iCloud ${path} → ${r.status}`);
    return r.json();
  }
  throw new Error("iCloud redirect loop");
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

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

// Return the checksum of the best derivative (largest fileSize under 2 MB).
function bestChecksum(photo) {
  return Object.values(photo.derivatives || {})
    .filter((d) => d.checksum && +d.fileSize > 10_000 && +d.fileSize < 2_000_000)
    .sort((a, b) => +b.fileSize - +a.fileSize)[0]?.checksum ?? null;
}

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  const TOKEN = process.env.ICLOUD_ALBUM_TOKEN;
  if (!TOKEN) return json({ photos: [], noKey: true });
  if (urlCache && Date.now() - urlCacheTime < URL_TTL) return json(urlCache);

  try {
    const store = getStore("board");
    const today = todayStr();

    // Load today's selection (GUID + checksum pairs) from Blobs, or compute fresh.
    let sel = await store.get("photo_sel", { type: "json" }).catch(() => null);
    if (!sel || sel.date !== today) {
      const stream = await icloudPost(`/${TOKEN}/sharedstreams/webstream`, { streamCtag: null });
      const all = (stream.photos || []).filter((p) => !/video/i.test(p.mediaAssetType || ""));
      if (!all.length) throw new Error("album is empty");
      const picked = seededPick(all, PICK_COUNT, today);
      sel = {
        date: today,
        photos: picked.map((p) => ({ guid: p.photoGuid, checksum: bestChecksum(p) }))
      };
      await store.set("photo_sel", JSON.stringify(sel));
    }

    // Fetch fresh CDN URLs — webasseturls response is keyed by checksum,
    // each item has url_location + url_path that combine to the download URL.
    const guids = sel.photos.map((p) => p.guid);
    const urlData = await icloudPost(`/${TOKEN}/sharedstreams/webasseturls`, { photoGuids: guids });
    const items = urlData.items || {};

    const photos = sel.photos
      .map(({ checksum }) => {
        if (!checksum) return null;
        const item = items[checksum];
        if (!item?.url_location || !item?.url_path) return null;
        return `https://${item.url_location}${item.url_path}`;
      })
      .filter(Boolean);

    if (!photos.length) throw new Error("no URLs resolved");
    urlCache = { photos };
    urlCacheTime = Date.now();
    return json(urlCache);
  } catch (e) {
    if (urlCache) return json(urlCache);
    return json({ photos: [], error: e.message });
  }
};
export const config = { path: "/api/photos" };
