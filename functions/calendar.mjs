import ICAL from "ical.js";
import { authed, json, getConfig } from "./_lib.mjs";
const cache = new Map();
async function fetchIcs(url) {
  const c = cache.get(url);
  if (c && Date.now() - c.t < 3e5) return c.d;
  const r = await fetch(url, { headers: { "user-agent": "DylanBoard" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.text();
  cache.set(url, { t: Date.now(), d });
  return d;
}
function expand(ics, from, to) {
  const out = [];
  const comp = new ICAL.Component(ICAL.parse(ics));
  comp.getAllSubcomponents("vtimezone").forEach((z) => { try { ICAL.TimezoneService.register(z); } catch {} });
  const evs = comp.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
  const exc = new Set();
  evs.forEach((e) => { if (e.recurrenceId) exc.add(e.uid + "|" + e.recurrenceId.toUnixTime()); });
  const push = (e, s, en) => {
    const a = s.toJSDate(), b = en.toJSDate();
    if (b <= from || a >= to) return;
    out.push(s.isDate ? { title: e.summary || "", start: s.toString(), end: en.toString(), allDay: true }
                      : { title: e.summary || "", start: a.toISOString(), end: b.toISOString(), allDay: false });
  };
  for (const e of evs) {
    if (e.component.getFirstPropertyValue("status") === "CANCELLED") continue;
    if (e.isRecurring() && !e.recurrenceId) {
      const it = e.iterator(); let n, i = 0;
      while ((n = it.next()) && i++ < 2000) {
        if (n.toJSDate() > to) break;
        if (exc.has(e.uid + "|" + n.toUnixTime())) continue;
        const d = e.getOccurrenceDetails(n);
        push(e, d.startDate, d.endDate);
      }
    } else push(e, e.startDate, e.endDate);
  }
  return out;
}
export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  const u = new URL(req.url);
  const from = new Date(u.searchParams.get("from")), to = new Date(u.searchParams.get("to"));
  if (isNaN(from) || isNaN(to)) return json({ error: "bad range" }, 400);
  const cfg = await getConfig(), events = [], errors = [];
  await Promise.all(cfg.calendars.map(async (c, i) => {
    if (!c.url) return;
    try { expand(await fetchIcs(c.url), from, to).forEach((e) => events.push({ ...e, cal: i })); }
    catch (err) { errors.push(c.name + ": " + err.message); }
  }));
  return json({ events, errors });
};
export const config = { path: "/api/calendar" };
