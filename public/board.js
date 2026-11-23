(() => {
const g = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let cfg = null;
async function api(p) { const r = await fetch(p); if (r.status === 401) { location = "/login.html"; throw 0; } return r.json(); }
const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pd = (x) => { const [y, m, d] = x.split("-"); return new Date(+y, m - 1, +d); };
function tick() {
  const d = new Date(), h = d.getHours() % 12 || 12;
  g("clk").innerHTML = `${h}:${String(d.getMinutes()).padStart(2, "0")}<small> ${d.getHours() < 12 ? "AM" : "PM"}</small>`;
  document.querySelector(".date").textContent = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  if (d.getHours() === 3 && d.getMinutes() === 0 && d.getSeconds() < 2) location.reload();
}
async function loadConfig() {
  cfg = await api("/api/config");
  g("legend").innerHTML = cfg.calendars.map((c) => `<span style="--c:${esc(c.color)}">${esc(c.emoji)} ${esc(c.name)}${c.url ? "" : " <small style='opacity:.5'>(no URL)</small>"}</span>`).join("");
  const t0 = day0(new Date());
  g("cds").innerHTML = cfg.countdowns.filter((c) => c.name && c.date).map((c) =>
    `<div class="cdr"><span>${esc(c.name)}</span><span><b>${Math.max(0, Math.round((pd(c.date) - t0) / 864e5))}</b><small>DAYS</small></span></div>`).join("");
  g("stocks").innerHTML = cfg.tickers.map((s) => `<div>${esc(s)}<b>—</b></div>`).join("");
}
async function loadCal() {
  if (!cfg) await loadConfig();
  const s = day0(new Date()); s.setDate(s.getDate() - s.getDay());
  const e = new Date(s); e.setDate(e.getDate() + 35);
  const r = await api(`/api/calendar?from=${s.toISOString()}&to=${e.toISOString()}`);
  const warn = g("cal-warn");
  if (warn) warn.textContent = r.errors && r.errors.length ? "⚠ " + r.errors.join(" · ") : "";
  const days = Array.from({ length: 35 }, () => []);
  const idx = (d) => Math.round((day0(d) - s) / 864e5);
  const tm = (d) => { const h = d.getHours() % 12 || 12, m = d.getMinutes(); return h + (m ? ":" + String(m).padStart(2, "0") : "") + (d.getHours() < 12 ? "a" : "p"); };
  for (const ev of r.events) {
    const c = cfg.calendars[ev.cal]; if (!c) continue;
    let a, b, label, sort;
    if (ev.allDay) { a = idx(pd(ev.start)); b = idx(pd(ev.end)) - 1; label = ev.title; sort = 0; }
    else { const d = new Date(ev.start); a = b = idx(d); label = tm(d) + " " + ev.title; sort = d.getTime(); }
    for (let i = Math.max(a, 0); i <= Math.min(Math.max(b, a), 34); i++)
      days[i].push({ sort, html: `<span class="ev" style="--c:${esc(c.color)}">${esc(c.emoji)} ${esc(label)}</span>` });
  }
  let h = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="hd">${d}</div>`).join("");
  days.forEach((list, i) => {
    const d = new Date(s); d.setDate(d.getDate() + i);
    const n = i === 0 || d.getDate() === 1 ? d.toLocaleString("en", { month: "short" }) + " " + d.getDate() : d.getDate();
    h += `<div class="d ${i ? "" : "today"}"><span class="n">${n}</span>${list.sort((x, y) => x.sort - y.sort).map((x) => x.html).join("")}</div>`;
  });
  g("cal").innerHTML = h;
}
tick(); setInterval(tick, 1000);
const safe = (f) => f().catch(() => {});
safe(loadConfig).then(() => safe(loadCal));
setInterval(() => safe(loadConfig), 6e5);
setInterval(() => safe(loadCal), 6e5);
})();
