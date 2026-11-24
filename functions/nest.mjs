import { authed, json } from "./_lib.mjs";

let accessToken = null, tokenExpiry = 0;
let nestCache = null, nestCacheTime = 0;
const CACHE_MS = 5 * 60_000;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60_000) return accessToken;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.NEST_REFRESH_TOKEN,
      grant_type:    "refresh_token"
    })
  });
  if (!r.ok) throw new Error("token refresh failed: " + r.status);
  const d = await r.json();
  if (!d.access_token) throw new Error(d.error_description || "no access token");
  accessToken = d.access_token;
  tokenExpiry = Date.now() + d.expires_in * 1000;
  return accessToken;
}

function cToF(c) { return Math.round(c * 9 / 5 + 32); }

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  if (!process.env.NEST_REFRESH_TOKEN) return json({ thermostats: [], noKey: true });
  if (nestCache && Date.now() - nestCacheTime < CACHE_MS) return json(nestCache);
  try {
    const token = await getAccessToken();
    const r = await fetch(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.NEST_PROJECT_ID}/devices`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (!r.ok) throw new Error("devices fetch failed: " + r.status);
    const d = await r.json();
    const thermostats = (d.devices || [])
      .filter((dev) => dev.type === "sdm.devices.types.THERMOSTAT")
      .map((dev) => {
        const tr = dev.traits || {};
        const tempC = tr["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius;
        const hvac  = tr["sdm.devices.traits.ThermostatHvac"]?.status || "OFF";
        const name  = tr["sdm.devices.traits.Info"]?.customName || "";
        return { name, temp: tempC != null ? cToF(tempC) : null, hvac };
      });
    nestCache = { thermostats };
    nestCacheTime = Date.now();
    return json(nestCache);
  } catch (e) {
    return json({ thermostats: [], error: e.message });
  }
};
export const config = { path: "/api/nest" };
