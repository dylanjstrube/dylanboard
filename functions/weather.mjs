import { authed, json } from "./_lib.mjs";

let cache = null, cacheTime = 0;
const CACHE_MS = 10 * 60_000;

const WX_ICON = {
  0:"☀️",1:"🌤️",2:"⛅",3:"☁️",
  45:"🌫️",48:"🌫️",
  51:"🌦️",53:"🌦️",55:"🌦️",
  61:"🌧️",63:"🌧️",65:"🌧️",
  71:"🌨️",73:"🌨️",75:"🌨️",77:"🌨️",
  80:"🌧️",81:"🌧️",82:"🌧️",
  85:"🌨️",86:"🌨️",
  95:"⛈️",96:"⛈️",99:"⛈️"
};
const WX_DESC = {
  0:"Clear",1:"Mostly clear",2:"Partly cloudy",3:"Overcast",
  45:"Fog",48:"Icy fog",
  51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",
  61:"Light rain",63:"Rain",65:"Heavy rain",
  71:"Light snow",73:"Snow",75:"Heavy snow",77:"Snow grains",
  80:"Rain showers",81:"Rain showers",82:"Heavy showers",
  85:"Snow showers",86:"Heavy snow showers",
  95:"Thunderstorm",96:"Thunderstorm + hail",99:"Thunderstorm + hail"
};
const WIND_DIR = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function moonPhase(date) {
  // Known new moon: Jan 6, 2000
  const days = (date - new Date(2000, 0, 6)) / 86400000;
  const phase = ((days % 29.53058867) + 29.53058867) % 29.53058867;
  if (phase < 1.85)  return "🌑 New moon";
  if (phase < 7.38)  return "🌒 Waxing crescent";
  if (phase < 9.22)  return "🌓 First quarter";
  if (phase < 14.76) return "🌔 Waxing gibbous";
  if (phase < 16.61) return "🌕 Full moon";
  if (phase < 22.15) return "🌖 Waning gibbous";
  if (phase < 23.99) return "🌗 Last quarter";
  return "🌘 Waning crescent";
}

// Open-Meteo returns times already in America/Chicago when timezone param is set
function fmtLocalIso(iso) {
  const [, t] = iso.split("T");
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

const toF   = (c)   => Math.round(c * 9 / 5 + 32);
const toMph = (k)   => Math.round(k * 0.621371);
const toInHg= (hpa) => (hpa * 0.02953).toFixed(2);
const toMi  = (m)   => (m / 1609.344).toFixed(1);
const wDir  = (deg) => WIND_DIR[Math.round(deg / 22.5) % 16];

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  if (cache && Date.now() - cacheTime < CACHE_MS) return json(cache);

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=43.0633&longitude=-88.4134" +
    "&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,winddirection_10m,relativehumidity_2m,surface_pressure,visibility" +
    "&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max,sunrise,sunset" +
    "&temperature_unit=celsius&windspeed_unit=kmh&timezone=America%2FChicago&forecast_days=6";

  const r = await fetch(url);
  if (!r.ok) return json({ error: "weather fetch failed" }, 502);
  const d = await r.json();
  const c = d.current;

  cache = {
    temp: toF(c.temperature_2m),
    feels: toF(c.apparent_temperature),
    desc: WX_DESC[c.weathercode] ?? "",
    wind: `${toMph(c.windspeed_10m)} mph ${wDir(c.winddirection_10m)}`,
    humidity: c.relativehumidity_2m + "%",
    pressure: toInHg(c.surface_pressure),
    visibility: toMi(c.visibility) + " mi",
    sunset: fmtLocalIso(d.daily.sunset[0]),
    moon: moonPhase(new Date()),
    forecast: d.daily.time.slice(0, 5).map((t, i) => ({
      day: i === 0 ? "Today" : DAY_NAMES[new Date(t + "T12:00:00").getDay()],
      icon: WX_ICON[d.daily.weathercode[i]] ?? "🌡️",
      precip: d.daily.precipitation_probability_max[i] ?? 0,
      high: toF(d.daily.temperature_2m_max[i]),
      low: toF(d.daily.temperature_2m_min[i])
    }))
  };
  cacheTime = Date.now();
  return json(cache);
};
export const config = { path: "/api/weather" };
