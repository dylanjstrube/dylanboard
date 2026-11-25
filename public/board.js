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
  g("legend").innerHTML = cfg.calendars.map((c) => `<span style="--c:${esc(c.color)}">${esc(c.emoji)} ${esc(c.name)}${c.hasUrl === false ? " <small style='opacity:.5'>(no URL)</small>" : ""}</span>`).join("");
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
function bbands(data, period = 20) {
  const out = [];
  for (let i = period - 1; i < data.length; i++) {
    const sl = data.slice(i - period + 1, i + 1);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    out.push({ i, upper: mean + 2 * std, lower: mean - 2 * std });
  }
  return out;
}

function drawSparkline(id, data, bollinger) {
  if (!data || data.length < 2) return;
  const bands = bollinger && data.length >= 20 ? bbands(data) : null;
  const allVals = [...data, ...(bands ? bands.flatMap((b) => [b.upper, b.lower]) : [])];
  const mn = Math.min(...allVals), mx = Math.max(...allVals);
  if (mn === mx) return;
  const n = data.length;
  const x = (i) => (i / (n - 1) * 200).toFixed(1);
  const y = (v) => (55 - (v - mn) / (mx - mn) * 50).toFixed(1);
  const pricePts = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  let svg = "";
  if (bands && bands.length >= 2) {
    const uPts = bands.map((b) => `${x(b.i)},${y(b.upper)}`).join(" ");
    const lPts = bands.map((b) => `${x(b.i)},${y(b.lower)}`).join(" ");
    const lPtsRev = [...bands].reverse().map((b) => `${x(b.i)},${y(b.lower)}`).join(" ");
    svg += `<polygon points="${uPts} ${lPtsRev}" fill="rgba(79,195,184,.12)" stroke="none"/>`;
    svg += `<polyline fill="none" stroke="rgba(79,195,184,.5)" stroke-width="1" points="${uPts}"/>`;
    svg += `<polyline fill="none" stroke="rgba(79,195,184,.5)" stroke-width="1" points="${lPts}"/>`;
  }
  svg += `<polyline fill="none" stroke="#5fd38d" stroke-width="2" points="${pricePts}"/>`;
  g(id).innerHTML = svg;
}

async function loadWeather() {
  const w = await api("/api/weather");
  g("wx-temp").textContent = w.temp + "°";
  g("wx-cond").textContent = `Feels like ${w.feels}° · ${w.desc}`;
  g("days").innerHTML = w.forecast.map((d) =>
    `<div><b>${esc(d.day)}</b><div class="i">${d.icon}</div><div class="p">💧${d.precip}%</div><div class="h"><b class="hi">${d.high}°</b>${d.low}°</div></div>`
  ).join("");
  g("wx-sunset").textContent   = w.sunset;
  g("wx-moon").textContent     = w.moon;
  g("wx-wind").textContent     = w.wind;
  g("wx-humidity").textContent = w.humidity;
  g("wx-pressure").textContent = w.pressure;
  g("wx-vis").textContent      = w.visibility;
}

async function loadStocks() {
  const d = await api("/api/stocks");
  if (d.quotes && d.quotes.length) {
    g("stocks").innerHTML = d.quotes.map((q) => {
      const up = q.pct != null && q.pct >= 0;
      const pct = q.pct != null
        ? `<i style="color:var(${up ? "--up" : "--dn"})">${up ? "▲" : "▼"} ${Math.abs(q.pct).toFixed(1)}%</i>`
        : "";
      return `<div>${esc(q.symbol)}${pct}<b>${q.price != null ? q.price.toFixed(2) : "—"}</b></div>`;
    }).join("");
  }
  if (d.sp) {
    const up = d.sp.pct >= 0;
    g("sp-px").innerHTML =
      `${d.sp.price.toFixed(2)} <span style="font-size:20px;color:var(${up ? "--up" : "--dn"})">${up ? "+" : ""}${d.sp.pct.toFixed(2)}%</span>`;
    drawSparkline("s7", d.sp.chart7);
    drawSparkline("s1", d.sp.chart1y, true);
  }
  setTimeout(() => safe(loadStocks), d.marketOpen ? 60_000 : 30 * 60_000);
}

tick(); setInterval(tick, 1000);
const safe = (f) => f().catch(() => {});
safe(loadConfig).then(() => safe(loadCal));
setInterval(() => safe(loadConfig), 6e5);
setInterval(() => safe(loadCal), 6e5);
async function loadHeadlines() {
  const d = await api("/api/headlines");
  const el = g("headlines");
  if (!el) return;
  if (d.headlines && d.headlines.length)
    el.innerHTML = d.headlines.map((h) => `<p>${esc(h)}</p>`).join("");
  else
    el.innerHTML = `<p style="opacity:.5">Headlines unavailable</p>`;
}

safe(loadWeather);
setInterval(() => safe(loadWeather), 6e5);
safe(loadStocks);
async function loadTodos() {
  const d = await api("/api/todos");
  const el = g("todo");
  if (!el) return;
  if (d.tasks && d.tasks.length)
    el.innerHTML = d.tasks.map((t) => `<li>${esc(t)}</li>`).join("");
  else if (!d.noKey)
    el.innerHTML = `<li style="opacity:.5">No tasks</li>`;
}

async function loadNest() {
  const d = await api("/api/nest");
  const el = g("nest");
  if (!el || d.noKey) return;
  if (!d.thermostats || !d.thermostats.length) return;
  const labels = ["1ST FLOOR", "2ND FLOOR"];
  el.innerHTML = d.thermostats.slice(0, 2).map((t, i) => {
    const hvac = t.hvac || "OFF";
    const cls  = hvac === "HEATING" ? "ht" : hvac === "COOLING" ? "cl" : "idle";
    const txt  = hvac === "HEATING" ? "🔥 HEATING" : hvac === "COOLING" ? "❄️ COOLING" : "IDLE";
    const sub  = [t.set != null ? `Set ${t.set}°` : "", t.humidity != null ? `💧 ${t.humidity}%` : ""].filter(Boolean).join("  ·  ");
    return `<div>${t.temp != null ? t.temp + "°" : "—"}<span>${labels[i]}</span>${sub ? `<span class="th-set">${sub}</span>` : ""}<em class="${cls}">${txt}</em></div>`;
  }).join("");
}

let photoUrls = [], photoIdx = 0;
async function loadPhotos() {
  const d = await api("/api/photos");
  if (d.photos && d.photos.length) {
    photoUrls = d.photos;
  } else if (d.loading) {
    // Cron hasn't run yet; retry in 5 minutes.
    setTimeout(() => safe(loadPhotos), 5 * 60_000);
  }
}
function showPhoto() {
  if (!photoUrls.length) return;
  const el = g("photo-bg");
  if (!el) return;
  el.style.backgroundImage = `url('${photoUrls[photoIdx]}')`;
  photoIdx = (photoIdx + 1) % photoUrls.length;
}

safe(loadPhotos).then(() => showPhoto());
// Re-fetch URLs before each rotation so iCloud CDN URLs are always fresh.
setInterval(() => safe(loadPhotos).then(() => showPhoto()), 10 * 60_000);

async function loadCamera() {
  const d = await api("/api/camera?t=" + Date.now());
  const el = g("cam-bg");
  if (!el) return;
  if (d.image) {
    el.style.backgroundImage = `url('data:image/jpeg;base64,${d.image}')`;
    const ts = g("cam-ts");
    if (ts && d.timestamp) ts.textContent = d.timestamp;
  }
}
safe(loadCamera);
setInterval(() => safe(loadCamera), 5 * 60_000);

safe(loadHeadlines);
setInterval(() => safe(loadHeadlines), 15 * 60_000);
safe(loadTodos);
setInterval(() => safe(loadTodos), 5 * 60_000);
safe(loadNest);
setInterval(() => safe(loadNest), 5 * 60_000);
})();
