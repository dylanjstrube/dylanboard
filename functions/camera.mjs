import { authed, json, store } from "./_lib.mjs";

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);

  const s = store();
  const [imgBuf, meta] = await Promise.all([
    s.get("blink_image", { type: "arrayBuffer" }).catch(() => null),
    s.get("blink_meta", { type: "json" }).catch(() => null),
  ]);

  if (!imgBuf) return json({ image: null, noImage: true });

  const b64 = Buffer.from(imgBuf).toString("base64");
  const tsMs = meta?.eventTs ? new Date(meta.eventTs).getTime()
    : meta?.createdAt ? new Date(meta.createdAt).getTime()
    : meta?.updatedAt ? meta.updatedAt : null;
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
