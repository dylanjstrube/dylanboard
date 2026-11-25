import { authed, json, store } from "./_lib.mjs";

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);

  const s = store();
  const [imgBuf, meta] = await Promise.all([
    // Strong reads: the board polls ~30 s after blink-cron writes, inside the
    // eventual-consistency window, and could otherwise get a stale image or label.
    s.get("blink_image", { type: "arrayBuffer", consistency: "strong" }).catch(() => null),
    s.get("blink_meta", { type: "json", consistency: "strong" }).catch(() => null),
  ]);

  if (!imgBuf) return json({ image: null, noImage: true });

  const b64 = Buffer.from(imgBuf).toString("base64");
  const urlTs = +(String(meta?.thumbUrl || "").match(/[?&]ts=(\d+)/)?.[1] || 0) * 1000;
  const tsMs = meta?.capturedAt || urlTs || meta?.updatedAt || null;
  const ts = tsMs
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        month: "numeric", day: "numeric",
        hour: "numeric", minute: "2-digit",
      }).format(new Date(tsMs))
    : null;

  return json({ image: b64, timestamp: ts, cameraName: meta?.cameraName || "Squirrel Box" });
};

export const config = { path: "/api/camera" };
