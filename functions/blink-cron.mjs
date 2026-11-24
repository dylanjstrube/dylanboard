import { getStore } from "@netlify/blobs";

const CAMERA_NAME = "Squirrel Box";
const TOKEN_URL = "https://api.oauth.blink.com/oauth/token";
const TIER_URL = "https://rest-prod.immedia-semi.com/api/v1/users/tier_info";
const TOKEN_UA = "Blink/2511191620 CFNetwork/3860.200.71 Darwin/25.1.0";

function base(tier) {
  return `https://rest-${tier || "prod"}.immedia-semi.com`;
}

function blinkHeaders(accessToken) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    "user-agent": TOKEN_UA,
  };
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
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  if (!data?.access_token) return null;

  // Re-fetch tier info if accountId is missing
  let { accountId, tier } = auth;
  if (!accountId) {
    const tr = await fetch(TIER_URL, {
      headers: { authorization: `Bearer ${data.access_token}`, "user-agent": TOKEN_UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (tr.ok) {
      const td = await tr.json().catch(() => ({}));
      accountId = td?.account?.id ?? null;
      tier = td?.account?.tier ?? tier;
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

export default async () => {
  const s = getStore("board");
  let auth = await s.get("blink_auth", { type: "json" }).catch(() => null);

  if (!auth?.accessToken) {
    console.log("blink-cron: not authenticated, skipping");
    return;
  }

  // Refresh token if expired or expiring within 5 minutes
  if (!auth.expiresAt || Date.now() > auth.expiresAt - 5 * 60_000) {
    auth = await refreshToken(auth, s);
    if (!auth) { console.log("blink-cron: token refresh failed"); return; }
  }

  if (!auth.accountId) {
    console.log("blink-cron: no accountId, skipping (re-authenticate in admin)");
    return;
  }

  try {
    const B = base(auth.tier);

    // Fetch the most recent media page (page 1 = newest first)
    const r = await fetch(`${B}/api/v1/accounts/${auth.accountId}/media/changed`, {
      method: "POST",
      headers: blinkHeaders(auth.accessToken),
      body: JSON.stringify({ since: "2001-01-01T00:00:00+0000", page: 1 }),
      signal: AbortSignal.timeout(15_000),
    });

    if (r.status === 401) {
      auth = await refreshToken(auth, s);
      if (!auth) { console.log("blink-cron: re-auth failed"); return; }
      // retry once
      const r2 = await fetch(`${B}/api/v1/accounts/${auth.accountId}/media/changed`, {
        method: "POST",
        headers: blinkHeaders(auth.accessToken),
        body: JSON.stringify({ since: "2001-01-01T00:00:00+0000", page: 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r2.ok) { console.log(`blink-cron: still failing after refresh: ${r2.status}`); return; }
    }
    if (!r.ok) throw new Error(`media/changed → ${r.status}`);

    const data = await r.json();
    const items = (data.media || []).filter(
      (m) => m.device_name === CAMERA_NAME && m.thumbnail && !m.deleted
    );

    if (!items.length) {
      console.log(`blink-cron: no media for "${CAMERA_NAME}"`);
      return;
    }

    // Newest first (API returns newest first, but sort to be safe)
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = items[0];

    // Build thumbnail URL — sometimes it's a full URL, sometimes a path
    let thumbUrl = latest.thumbnail;
    if (!thumbUrl.startsWith("http")) thumbUrl = `${B}${thumbUrl}`;
    // Blink thumbnails need .jpg appended if not already present
    if (!thumbUrl.includes(".jpg") && !thumbUrl.includes(".jpeg")) thumbUrl += ".jpg";

    // Check if we already have this one stored
    const meta = await s.get("blink_meta", { type: "json" }).catch(() => null);
    if (meta?.createdAt === latest.created_at) {
      console.log("blink-cron: no new motion event");
      return;
    }

    // Download the JPEG thumbnail
    const img = await fetch(thumbUrl, {
      headers: { authorization: `Bearer ${auth.accessToken}`, "user-agent": TOKEN_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!img.ok) throw new Error(`thumbnail download → ${img.status}`);

    const buf = await img.arrayBuffer();
    await s.set("blink_image", buf, { metadata: { type: "image/jpeg" } });
    await s.set("blink_meta", JSON.stringify({
      createdAt: latest.created_at,
      cameraName: latest.device_name,
      updatedAt: Date.now(),
    }));

    console.log(`blink-cron: saved thumbnail from ${latest.created_at}`);
  } catch (e) {
    console.error("blink-cron error:", e.message);
  }
};

export const config = { schedule: "*/5 * * * *" };
