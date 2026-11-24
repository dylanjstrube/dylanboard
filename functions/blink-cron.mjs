import { getStore } from "@netlify/blobs";

const CAMERA_NAME = "Squirrel Box";
const TOKEN_URL = "https://api.oauth.blink.com/oauth/token";
const TIER_URL = "https://rest-prod.immedia-semi.com/api/v1/users/tier_info";
const TOKEN_UA = "Blink/2511191620 CFNetwork/3860.200.71 Darwin/25.1.0";

function base(tier) {
  return `https://rest-${tier || "prod"}.immedia-semi.com`;
}

function blinkFetch(url, token, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "user-agent": TOKEN_UA,
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

async function refreshToken(auth, s) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": TOKEN_UA },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
      client_id: "ios",
      scope: "client",
      ...(auth.hardwareId ? { hardware_id: auth.hardwareId } : {}),
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) { console.log(`blink-cron: token refresh failed ${r.status}`); return null; }
  const data = await r.json().catch(() => null);
  if (!data?.access_token) return null;

  let { accountId, tier } = auth;
  if (!accountId) {
    const tr = await fetch(TIER_URL, {
      headers: { authorization: `Bearer ${data.access_token}`, "user-agent": TOKEN_UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (tr.ok) {
      const td = await tr.json().catch(() => ({}));
      accountId = td?.account_id ?? null;
      tier = td?.tier ?? tier;
    }
  }

  const updated = {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountId,
    tier,
  };
  await s.set("blink_auth", JSON.stringify(updated));
  return updated;
}

function findCamera(data) {
  for (const cam of [].concat(data?.cameras ?? [])) {
    const name = cam?.name || cam?.device?.name;
    if (name === CAMERA_NAME) return cam;
  }
  for (const net of [].concat(data?.networks ?? [])) {
    for (const cam of [].concat(net?.cameras ?? [])) {
      const name = cam?.name || cam?.device?.name;
      if (name === CAMERA_NAME) return cam;
    }
  }
  return null;
}

async function getHomescreen(B, accountId, token) {
  const r = await blinkFetch(`${B}/api/v3/accounts/${accountId}/homescreen`, token);
  if (!r.ok) { console.log(`blink-cron: homescreen → ${r.status}`); return null; }
  return r.json();
}

async function downloadThumb(path, token, B) {
  let url = path.startsWith("http") ? path : `${B}${path}`;
  if (!url.match(/\.(jpg|jpeg|png)(\?|$)/i)) url += ".jpg";
  const r = await blinkFetch(url, token);
  if (!r.ok) { console.log(`blink-cron: thumbnail download → ${r.status}`); return null; }
  return r.arrayBuffer();
}

export default async () => {
  const s = getStore("board");
  let auth = await s.get("blink_auth", { type: "json" }).catch(() => null);

  if (!auth?.accessToken) { console.log("blink-cron: not authenticated, skipping"); return; }

  if (!auth.expiresAt || Date.now() > auth.expiresAt - 5 * 60_000) {
    auth = await refreshToken(auth, s);
    if (!auth) { console.log("blink-cron: token refresh failed"); return; }
  }

  if (!auth.accountId) {
    console.log("blink-cron: no accountId — re-authenticate in admin");
    return;
  }

  try {
    const B = base(auth.tier);
    const meta = await s.get("blink_meta", { type: "json" }).catch(() => null);

    // ── Step 1: homescreen — get camera ID and network ID ─────────────────────
    let hsData = await getHomescreen(B, auth.accountId, auth.accessToken);
    if (!hsData) {
      auth = await refreshToken(auth, s);
      if (!auth) return;
      hsData = await getHomescreen(B, auth.accountId, auth.accessToken);
      if (!hsData) return;
    }
    const cam = findCamera(hsData);
    if (!cam) {
      const names = [].concat(hsData?.cameras ?? []).map(c => c?.name).filter(Boolean);
      console.log(`blink-cron: "${CAMERA_NAME}" not found. Available: ${names.join(", ") || "(none)"}`);
      return;
    }
    const networkId = cam.network_id;
    const cameraId  = cam.id ?? cam.camera_id;

    // ── Step 2: request a fresh snapshot from the camera ──────────────────────
    // POST /network/{nid}/camera/{cid}/thumbnail tells the camera to wake up,
    // take a still, and upload it to Blink. Free plan supports this.
    let snapUpdatedAt = null;
    if (networkId && cameraId) {
      const snapR = await blinkFetch(
        `${B}/network/${networkId}/camera/${cameraId}/thumbnail`,
        auth.accessToken,
        { method: "POST" },
      );
      if (snapR.ok) {
        const snapData = await snapR.json().catch(() => ({}));
        snapUpdatedAt = snapData?.updated_at ?? null;
        console.log(`blink-cron: snapshot requested updated_at=${snapUpdatedAt}`);
        // Wait for camera to respond and upload its still (usually 5–10 s)
        await new Promise(r => setTimeout(r, 8000));
      } else {
        console.log(`blink-cron: snapshot request → ${snapR.status}`);
      }
    }

    // If the snapshot command's updated_at matches what we last saved, the
    // camera hasn't taken a new shot since our last run — skip the download.
    if (snapUpdatedAt && meta?.snapUpdatedAt === snapUpdatedAt) {
      console.log("blink-cron: snapshot unchanged");
      return;
    }

    // ── Step 3: re-read homescreen for the updated thumbnail URL ─────────────
    const hs2 = await getHomescreen(B, auth.accountId, auth.accessToken);
    const cam2 = hs2 ? findCamera(hs2) : cam;
    const thumbPath = cam2?.thumbnail || cam2?.thumbnail_url || cam?.thumbnail;
    if (!thumbPath) { console.log("blink-cron: no thumbnail on camera"); return; }

    // ── Step 4: download and store ────────────────────────────────────────────
    const buf = await downloadThumb(thumbPath, auth.accessToken, B);
    if (!buf) return;
    await s.set("blink_image", buf, { metadata: { type: "image/jpeg" } });
    const thumbUrl = thumbPath.startsWith("http") ? thumbPath : `${B}${thumbPath}`;
    await s.set("blink_meta", JSON.stringify({
      thumbUrl,
      snapUpdatedAt,
      cameraName: cam2?.name || CAMERA_NAME,
      updatedAt: Date.now(),
    }));
    console.log(`blink-cron: saved thumbnail (${buf.byteLength} bytes)`);
  } catch (e) {
    console.error("blink-cron error:", e.message);
  }
};

export const config = { schedule: "*/5 * * * *" };
