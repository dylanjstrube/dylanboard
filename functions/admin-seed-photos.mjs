// Temporary local seeding endpoint — not committed to production.
// Usage: POST /api/admin-seed-photos with JSON body {password, photos, updatedAt}
import { json } from "./_lib.mjs";
import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => null);
  if (!body || body.password !== process.env.BOARD_PASSWORD)
    return json({ error: "unauthorized" }, 401);
  const store = getStore("board");
  await store.set("photo_meta", JSON.stringify({ photos: body.photos, updatedAt: body.updatedAt || Date.now() }));
  return json({ ok: true, count: body.photos?.length });
};
export const config = { path: "/api/admin-seed-photos" };
