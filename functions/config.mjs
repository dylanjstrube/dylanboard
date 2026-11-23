import { authed, json, store, getConfig } from "./_lib.mjs";
export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  if (req.method === "GET") {
    const c = await getConfig();
    if (!new URL(req.url).searchParams.has("admin")) c.calendars = c.calendars.map(({ url, ...x }) => x);
    return json(c);
  }
  if (req.method === "PUT") {
    const b = await req.json().catch(() => ({}));
    const c = {
      calendars: (b.calendars || []).slice(0, 5).map((x) => ({
        name: String(x.name || "").slice(0, 40), emoji: String(x.emoji || "").slice(0, 8),
        color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : "#4fc3b8",
        url: String(x.url || "").trim().replace(/^webcal:/i, "https:") })),
      tickers: (b.tickers || []).map((t) => String(t).toUpperCase().replace(/[^A-Z0-9.\-]/g, "")).filter(Boolean).slice(0, 16),
      countdowns: (b.countdowns || []).slice(0, 3).map((x) => ({ name: String(x.name || "").slice(0, 40), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : "" }))
    };
    await store().setJSON("config", c);
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
};
export const config = { path: "/api/config" };
