#!/usr/bin/env node
// One-time script to get a Google OAuth refresh token for DylanBoard.
// Usage: node scripts/get-google-token.mjs <CLIENT_ID> <CLIENT_SECRET>
import http from "node:http";
import { exec } from "node:child_process";

const [, , CLIENT_ID, CLIENT_SECRET] = process.argv;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Usage: node scripts/get-google-token.mjs <CLIENT_ID> <CLIENT_SECRET>");
  process.exit(1);
}

const PORT = 3456;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/tasks.readonly";
const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log("\nOpening browser for Google authorization…\n");
exec(`open "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  if (!code) { res.end("No code — close this tab."); return; }
  res.end("<h2>Authorization complete — you can close this tab.</h2>");
  server.close();

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code"
    })
  });
  const d = await r.json();
  if (d.refresh_token) {
    console.log("✅  Success! Run these three commands:\n");
    console.log(`netlify env:set GOOGLE_CLIENT_ID "${CLIENT_ID}"`);
    console.log(`netlify env:set GOOGLE_CLIENT_SECRET "${CLIENT_SECRET}"`);
    console.log(`netlify env:set GOOGLE_TASKS_REFRESH_TOKEN "${d.refresh_token}"`);
    console.log("\nThen: netlify deploy --prod");
  } else {
    console.error("❌  Error:", JSON.stringify(d, null, 2));
  }
});
server.listen(PORT, () =>
  console.log(`Waiting for Google to redirect to http://localhost:${PORT} …`)
);
