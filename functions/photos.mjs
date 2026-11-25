import { authed, json } from "./_lib.mjs";
import { getStore } from "@netlify/blobs";

// CDN URLs from webasseturls can expire in as little as a few minutes;
// keep the in-memory cache short so each rotation gets a fresh URL set.
const URL_CACHE_TTL = 8 * 60_000;
const PICK_COUNT = 5;

let urlCache = null, urlCacheTime = 0;

// webasseturls responds in ~2s — safe within the 10-second function timeout.
// webstream takes ~50s and is handled by photos-cron.mjs instead.
async function icloudPost(path, body) {
  let host = "p23-sharedstreams.icloud.com";
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "https://www.icloud.com" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
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

function chicagoDayNumber() {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return Math.floor(Date.parse(ymd + "T00:00:00Z") / 864e5);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Hash order acts as a fixed shuffle that stays stable as photos are added,
// so walking it 5 per day shows every photo once before any repeats.
function dailyPick(arr, count, day) {
  const order = [...arr].sort((a, b) => hash(a.guid) - hash(b.guid));
  const start = (day * count) % order.length;
  return Array.from({ length: Math.min(count, order.length) }, (_, i) => order[(start + i) % order.length]);
}

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  const TOKEN = process.env.ICLOUD_ALBUM_TOKEN;
  if (!TOKEN) return json({ photos: [], noKey: true });
  const day = chicagoDayNumber();
  if (urlCache && urlCache.day === day && Date.now() - urlCacheTime < URL_CACHE_TTL) return json(urlCache);

  try {
    const store = getStore("board");
    const meta = await store.get("photo_meta", { type: "json" }).catch(() => null);
    if (!meta || !meta.photos || !meta.photos.length) {
      // Cron hasn't run yet. Return empty; board will retry in 5 min.
      return json({ photos: [], loading: true });
    }

    const picked = dailyPick(meta.photos, PICK_COUNT, day);
    const guids = picked.map((p) => p.guid);

    const urlData = await icloudPost(`/${TOKEN}/sharedstreams/webasseturls`, { photoGuids: guids });
    const items = urlData.items || {};

    const photos = picked
      .map(({ checksum }) => {
        if (!checksum) return null;
        const item = items[checksum];
        if (!item?.url_location || !item?.url_path) return null;
        return `https://${item.url_location}${item.url_path}`;
      })
      .filter(Boolean);

    if (!photos.length) throw new Error("no URLs resolved");
    urlCache = { photos, day };
    urlCacheTime = Date.now();
    return json(urlCache);
  } catch (e) {
    if (urlCache) return json(urlCache);
    return json({ photos: [], error: e.message });
  }
};

export const config = { path: "/api/photos" };
