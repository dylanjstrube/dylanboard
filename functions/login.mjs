import crypto from "node:crypto";
import { sign, json } from "./_lib.mjs";
const h = (s) => crypto.createHash("sha256").update(s).digest();
export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const { password = "" } = await req.json().catch(() => ({}));
  const want = process.env.BOARD_PASSWORD || "";
  if (!want || !crypto.timingSafeEqual(h(String(password)), h(want))) return json({ error: "bad password" }, 401);
  const exp = Date.now() + 180 * 864e5;
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json",
    "set-cookie": `board=${sign(String(exp))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${180 * 86400}` } });
};
export const config = { path: "/api/login" };
