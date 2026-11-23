import { authed, json } from "./_lib.mjs";

let accessToken = null, tokenExpiry = 0;
let taskCache = null, taskCacheTime = 0;
const TASK_TTL = 5 * 60_000;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60_000) return accessToken;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_TASKS_REFRESH_TOKEN,
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

export default async (req) => {
  if (!authed(req)) return json({ error: "auth" }, 401);
  if (!process.env.GOOGLE_TASKS_REFRESH_TOKEN) return json({ tasks: [], noKey: true });
  if (taskCache && Date.now() - taskCacheTime < TASK_TTL) return json(taskCache);
  try {
    const token = await getAccessToken();
    const listId = process.env.GOOGLE_TASKS_LIST_ID || "@default";
    const r = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks` +
      `?showCompleted=false&showHidden=false&maxResults=10`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (!r.ok) throw new Error("tasks fetch failed: " + r.status);
    const d = await r.json();
    const tasks = (d.items || [])
      .filter((t) => t.status !== "completed" && t.title)
      .map((t) => t.title);
    taskCache = { tasks };
    taskCacheTime = Date.now();
    return json(taskCache);
  } catch (e) {
    return json({ tasks: [], error: e.message });
  }
};
export const config = { path: "/api/todos" };
