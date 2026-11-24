import { authed, json, store } from "./_lib.mjs";
import crypto from "node:crypto";
import https from "node:https";

// ── Constants ──────────────────────────────────────────────────────────────
const OAUTH_HOST = "api.oauth.blink.com";
const AUTHORIZE_PATH = "/oauth/v2/authorize";
const SIGNIN_PATH = "/oauth/v2/signin";
const VERIFY_2FA_PATH = "/oauth/v2/2fa/verify";
const TOKEN_PATH = "/oauth/token";
const REDIRECT_URI = "immedia-blink://applinks.blink.com/signin/callback";
const BROWSER_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
const TOKEN_UA = "Blink/2511191620 CFNetwork/3860.200.71 Darwin/25.1.0";

// ── Encrypt/decrypt password for temporary Blobs storage ──────────────────
function encryptText(text) {
  const secret = process.env.SESSION_SECRET || "dev-secret";
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decryptText(enc) {
  const secret = process.env.SESSION_SECRET || "dev-secret";
  const key = crypto.createHash("sha256").update(secret).digest();
  const buf = Buffer.from(enc, "base64url");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data, null, "utf8") + decipher.final("utf8");
}

// ── PKCE ───────────────────────────────────────────────────────────────────
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ── Cookie jar ─────────────────────────────────────────────────────────────
function parseCookies(setCookieHeaders) {
  const jar = {};
  for (const h of [].concat(setCookieHeaders || [])) {
    const [nameVal] = (h || "").split(";");
    const eq = nameVal.indexOf("=");
    if (eq < 0) continue;
    jar[nameVal.slice(0, eq).trim()] = nameVal.slice(eq + 1).trim();
  }
  return jar;
}
const cookieStr = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

// ── Raw HTTPS request (no auto-redirect, full header access) ───────────────
function rawRequest(host, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.setTimeout(20_000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Follow same-host redirects, collecting cookies.
// Stops and returns the response when a cross-origin redirect appears,
// so callers can read the Location header (e.g. immedia-blink://...).
async function getFollowingRedirects(host, path, headers, cookies = {}) {
  let lastR = null;
  for (let i = 0; i < 8; i++) {
    const r = await rawRequest(host, path, {
      headers: { ...headers, ...(Object.keys(cookies).length ? { cookie: cookieStr(cookies) } : {}) },
    });
    lastR = r;
    Object.assign(cookies, parseCookies(r.headers["set-cookie"]));
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
      let loc;
      try { loc = new URL(r.headers.location, `https://${host}`); } catch { break; }
      if (loc.hostname !== host) break; // cross-origin (e.g. immedia-blink://) — stop, return this response
      path = loc.pathname + loc.search;
      continue;
    }
    return { r, cookies };
  }
  return { r: lastR, cookies };
}

// ── CSRF token extraction ──────────────────────────────────────────────────
function extractCsrf(html) {
  const script = html.match(/<script[^>]+id=["']oauth-args["'][^>]*>([\s\S]*?)<\/script>/i);
  if (script) {
    try {
      const d = JSON.parse(script[1]);
      return d.csrf_token || d["csrf-token"] || null;
    } catch {}
  }
  const input = html.match(/<input[^>]+name=["']csrf[-_]token["'][^>]+value=["']([^"']+)["']/i)
    || html.match(/<input[^>]+value=["']([^"']+)["'][^>]+name=["']csrf[-_]token["']/i);
  if (input) return input[1];
  return null;
}

// ── Full PKCE flow: GET authorize → GET signin → POST creds → [2FA] → code → token ──
// pin is null for the initial login attempt (which may hit 2FA).
// Returns { done, authData } or { requiresPin } or throws.
async function runPKCEFlow(email, password, hardwareId, pin) {
  const { verifier, challenge } = generatePKCE();
  const authorizeParams = new URLSearchParams({
    app_brand: "blink", app_version: "50.1", client_id: "ios",
    code_challenge: challenge, code_challenge_method: "S256",
    device_brand: "Apple", device_model: "iPhone16,1", device_os_version: "26.1",
    hardware_id: hardwareId, redirect_uri: REDIRECT_URI,
    response_type: "code", scope: "client",
  });
  const authorizeQuery = authorizeParams.toString();
  const browserHeaders = {
    "user-agent": BROWSER_UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  };

  // Step 1: GET authorize → collect session cookies
  const { cookies: c1 } = await getFollowingRedirects(OAUTH_HOST, `${AUTHORIZE_PATH}?${authorizeQuery}`, browserHeaders);

  // Step 2: GET signin → extract CSRF token
  const r2 = await rawRequest(OAUTH_HOST, SIGNIN_PATH, {
    headers: { ...browserHeaders, cookie: cookieStr(c1) },
  });
  const c2 = { ...c1, ...parseCookies(r2.headers["set-cookie"]) };
  const csrfToken = extractCsrf(r2.body);
  if (!csrfToken) {
    console.error("blink-auth: no CSRF token in signin page:", r2.body.slice(0, 400));
    throw new Error("Could not parse CSRF token from Blink signin page");
  }

  // Step 3: POST credentials
  const signinBody = new URLSearchParams({ username: email, password, "csrf-token": csrfToken }).toString();
  const r3 = await rawRequest(OAUTH_HOST, SIGNIN_PATH, {
    method: "POST",
    headers: {
      "user-agent": BROWSER_UA, "content-type": "application/x-www-form-urlencoded",
      accept: "*/*", origin: `https://${OAUTH_HOST}`,
      referer: `https://${OAUTH_HOST}${SIGNIN_PATH}`, cookie: cookieStr(c2),
    },
    body: signinBody,
  });
  const c3 = { ...c2, ...parseCookies(r3.headers["set-cookie"]) };
  console.log(`blink-auth POST signin → ${r3.status}`);

  // If 2FA is required
  const needs2FA = r3.status === 412 || (r3.status === 202 && r3.body.includes("tsv"));
  // Default authorize path; may be overridden by 2FA verify response
  let authorizePath = `${AUTHORIZE_PATH}?${authorizeQuery}`;
  if (needs2FA) {
    if (pin == null) {
      // First login attempt: return early so user can supply the PIN
      return { requiresPin: true, verifier, authorizeQuery, cookies: c3, csrfToken };
    }
    // We have the PIN: verify it right here in the same session
    const r2fa = await rawRequest(OAUTH_HOST, VERIFY_2FA_PATH, {
      method: "POST",
      headers: {
        "user-agent": BROWSER_UA, "content-type": "application/x-www-form-urlencoded",
        accept: "*/*", origin: `https://${OAUTH_HOST}`,
        referer: `https://${OAUTH_HOST}${SIGNIN_PATH}`, cookie: cookieStr(c3),
      },
      body: new URLSearchParams({ "2fa_code": String(pin), "csrf-token": csrfToken, remember_me: "false" }).toString(),
    });
    console.log(`blink-auth 2FA verify → ${r2fa.status}`);
    if (r2fa.status < 200 || r2fa.status >= 400) {
      throw new Error(`PIN verify failed: ${r2fa.status} — ${r2fa.body.slice(0, 200)}`);
    }
    Object.assign(c3, parseCookies(r2fa.headers["set-cookie"]));
    // The verify response body contains the exact path to call next.
    // e.g. {"redirect_url":"/oauth/v2/authorize","status":"auth-completed",...}
    // Using that bare path (no PKCE params) resumes the existing server-side
    // session instead of starting a new authorize flow.
    try {
      const vd = JSON.parse(r2fa.body);
      if (vd.redirect_url) authorizePath = vd.redirect_url;
    } catch {}
  } else if (![200, 201, 301, 302, 303, 307, 308].includes(r3.status)) {
    throw new Error(`Signin failed: ${r3.status} — ${r3.body.slice(0, 200)}`);
  }

  // Step 4: GET authorize (or the redirect_url from 2FA verify), follow
  // same-host hops until we hit the cross-origin immedia-blink:// callback.
  const { r: r4, cookies: c4 } = await getFollowingRedirects(
    OAUTH_HOST, authorizePath,
    { "user-agent": BROWSER_UA, accept: "*/*", referer: `https://${OAUTH_HOST}${SIGNIN_PATH}` },
    { ...c3 },
  );
  const location = r4?.headers?.location || "";
  console.log(`blink-auth authorize final → status ${r4?.status}, location: ${location.slice(0, 60)}`);
  if (!location) throw new Error(`no Location on authorize (status ${r4?.status}): ${(r4?.body || "").slice(0, 200)}`);

  const qStart = location.indexOf("?");
  const code = new URLSearchParams(qStart >= 0 ? location.slice(qStart + 1) : "").get("code");
  if (!code) throw new Error(`no code in Location: ${location}`);

  // Step 5: exchange code for tokens
  const tokenBody = new URLSearchParams({
    app_brand: "blink", client_id: "ios", code, code_verifier: verifier,
    grant_type: "authorization_code", hardware_id: hardwareId,
    redirect_uri: REDIRECT_URI, scope: "client",
  }).toString();
  const r5 = await rawRequest(OAUTH_HOST, TOKEN_PATH, {
    method: "POST",
    headers: { "user-agent": TOKEN_UA, "content-type": "application/x-www-form-urlencoded", accept: "*/*" },
    body: tokenBody,
  });
  const tokenData = JSON.parse(r5.body);
  if (!tokenData.access_token) throw new Error(`token exchange failed ${r5.status}: ${r5.body.slice(0, 200)}`);

  // Step 6: get tier/account info
  const tierR = await rawRequest("rest-prod.immedia-semi.com", "/api/v1/users/tier_info", {
    headers: { authorization: `Bearer ${tokenData.access_token}`, "user-agent": TOKEN_UA },
  });
  console.log(`blink-auth tier_info → ${tierR.status}:`, tierR.body.slice(0, 400));
  const tierData = tierR.status === 200 ? JSON.parse(tierR.body) : {};

  return {
    done: true,
    authData: {
      hardwareId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
      accountId: tierData?.account_id ?? null,
      tier: tierData?.tier ?? "prod",
    },
  };
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "bad body" }, 400);

  const s = store();

  // Status
  if (body.action === "status") {
    const auth = await s.get("blink_auth", { type: "json" }).catch(() => null);
    return json({ connected: !!auth?.accessToken, tier: auth?.tier });
  }

  // Disconnect
  if (body.action === "disconnect") {
    await Promise.all(["blink_auth", "blink_image", "blink_meta", "blink_pending"]
      .map(k => s.delete(k).catch(() => {})));
    return json({ ok: true });
  }

  // ── Login (initiates PKCE flow; returns requiresPin if 2FA needed) ────────
  if (body.action === "login") {
    const { email, password } = body;
    if (!email || !password) return json({ error: "email and password required" }, 400);

    const existing = await s.get("blink_auth", { type: "json" }).catch(() => null);
    const hardwareId = existing?.hardwareId || crypto.randomUUID().toUpperCase();

    try {
      const result = await runPKCEFlow(email, password, hardwareId, null);
      if (result.requiresPin) {
        // Store email + encrypted password so verify can redo the full flow
        await s.set("blink_pending", JSON.stringify({
          email, encPassword: encryptText(password), hardwareId,
        }));
        return json({ requiresPin: true });
      }
      await s.set("blink_auth", JSON.stringify(result.authData));
      return json({ ok: true });
    } catch (e) {
      console.error("blink-auth login error:", e.message);
      return json({ error: e.message }, 502);
    }
  }

  // ── Verify PIN: redo full PKCE flow with the PIN ready ───────────────────
  if (body.action === "verify") {
    const { pin } = body;
    if (!pin) return json({ error: "pin required" }, 400);

    const pending = await s.get("blink_pending", { type: "json" }).catch(() => null);
    if (!pending?.email) return json({ error: "no pending login — start with action:login first" }, 400);

    let password;
    try { password = decryptText(pending.encPassword); }
    catch { return json({ error: "could not decrypt stored credentials — please sign in again" }, 400); }

    try {
      const result = await runPKCEFlow(pending.email, password, pending.hardwareId, pin);
      if (result.requiresPin) {
        // Unexpected second 2FA challenge with no way to handle it
        return json({ error: "Blink requested a second 2FA — the PIN you entered may have been wrong. Please sign in again." }, 502);
      }
      await s.set("blink_auth", JSON.stringify(result.authData));
      await s.delete("blink_pending").catch(() => {});
      return json({ ok: true });
    } catch (e) {
      console.error("blink-auth verify error:", e.message);
      return json({ error: e.message }, 502);
    }
  }

  return json({ error: "unknown action" }, 400);
};

export const config = { path: "/api/blink-auth" };
