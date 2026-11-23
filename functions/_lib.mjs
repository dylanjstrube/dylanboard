import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
const secret = () => process.env.SESSION_SECRET || "";
export const sign = (v) => v + "." + crypto.createHmac("sha256", secret()).update(v).digest("hex");
export function verify(tok) {
  if (!tok || !secret()) return false;
  const i = tok.lastIndexOf(".");
  if (i < 0) return false;
  const a = Buffer.from(sign(tok.slice(0, i))), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(tok.slice(0, i)) > Date.now();
}
export const authed = (req) => verify((req.headers.get("cookie") || "").match(/(?:^|; )board=([^;]+)/)?.[1]);
export const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const store = () => getStore("board");
export const DEFAULTS = {
  calendars: [],
  tickers: ["ABNB","AMZN","BRK.B","DIS","DXCM","IDXX","NET","NFLX","NVDA","PYPL","ROKU","SHOP","SPOT","TSLA","VOO","ZM"],
  countdowns: [{ name: "Christmas", date: "2026-12-25" }, { name: "Big Powderhorn Skiing", date: "2027-01-21" }, { name: "Noah Kahan Concert", date: "2027-05-26" }]
};
export async function getConfig() { return { ...DEFAULTS, ...((await store().get("config", { type: "json" })) || {}) }; }
