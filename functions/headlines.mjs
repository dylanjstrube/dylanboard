import { authed, json } from "./_lib.mjs";

let cache = null, cacheTime = 0;
const CACHE_MS = 15 * 60_000;
const FEED_URL = "https://feeds.bbci.co.uk/news/rss.xml";

function tagContent(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function parseItems(xml, max = 7) {
  const out = [];
  const rx = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = rx.exec(xml)) && out.length < max) {
    const title = tagContent(m[1], "title");
    if (title) out.push(title);
  }
  return out;
}

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  if (cache && Date.now() - cacheTime < CACHE_MS) return json(cache);
  try {
    const r = await fetch(FEED_URL, { headers: { "user-agent": "DylanBoard/1.0" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const headlines = parseItems(await r.text());
    cache = { headlines };
    cacheTime = Date.now();
    return json(cache);
  } catch (e) {
    return json({ headlines: [], error: e.message });
  }
};
export const config = { path: "/api/headlines" };
