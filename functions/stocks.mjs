import { authed, json, getConfig } from "./_lib.mjs";

const quoteCache = new Map(); // symbol → {price, pct, t}
const candleCache = new Map(); // key → {data, t}
const QUOTE_TTL  = 60_000;
const CANDLE_TTL = 15 * 60_000;

function isMarketOpen() {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

async function fetchQuote(symbol, key) {
  const c = quoteCache.get(symbol);
  if (c && Date.now() - c.t < QUOTE_TTL) return c;
  const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  if (!d.c) throw new Error("no data");
  const v = { price: d.c, pct: d.dp, t: Date.now() };
  quoteCache.set(symbol, v);
  return v;
}

async function fetchCandles(symbol, resolution, fromSec, key) {
  const cKey = symbol + resolution;
  const c = candleCache.get(cKey);
  if (c && Date.now() - c.t < CANDLE_TTL) return c.data;
  const to = Math.floor(Date.now() / 1000);
  const r = await fetch(
    `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${fromSec}&to=${to}&token=${key}`
  );
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const data = d.s === "ok" ? d.c : [];
  candleCache.set(cKey, { data, t: Date.now() });
  return data;
}

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  const key = process.env.FINNHUB_KEY;
  if (!key) return json({ quotes: [], sp: null, marketOpen: isMarketOpen(), noKey: true });

  const cfg = await getConfig();
  const symbols = cfg.tickers.slice(0, 16);
  const now = Math.floor(Date.now() / 1000);

  const [quoteResults, chart7, chart1y] = await Promise.all([
    Promise.allSettled(symbols.map((s) => fetchQuote(s, key))),
    fetchCandles("VOO", "D", now - 10 * 86400, key).catch(() => []),
    fetchCandles("VOO", "W", now - 365 * 86400, key).catch(() => [])
  ]);

  const quotes = quoteResults.map((r, i) =>
    r.status === "fulfilled"
      ? { symbol: symbols[i], price: r.value.price, pct: r.value.pct }
      : { symbol: symbols[i], price: null, pct: null }
  );

  const voo = quoteResults[symbols.indexOf("VOO")];
  const spQuote = voo?.status === "fulfilled" ? voo.value : await fetchQuote("VOO", key).catch(() => null);

  return json({
    quotes,
    marketOpen: isMarketOpen(),
    sp: spQuote ? { price: spQuote.price, pct: spQuote.pct, chart7, chart1y } : null
  });
};
export const config = { path: "/api/stocks" };
