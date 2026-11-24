#!/usr/bin/env node
// One-time script to get a Nest/SDM OAuth refresh token for DylanBoard.
// Usage: node scripts/get-nest-token.mjs <DEVICE_ACCESS_PROJECT_ID>
// CLIENT_ID and CLIENT_SECRET are read from .env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
import http from "node:http";
import { exec } from "node:child_process";
import { readFileSync } from "node:fs";

try {
  const env = readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const [, , PROJECT_ID, CLI_ID, CLI_SECRET] = process.argv;
const CLIENT_ID     = CLI_ID     || process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = CLI_SECRET || process.env.GOOGLE_CLIENT_SECRET;

if (!PROJECT_ID || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Usage: node scripts/get-nest-token.mjs <PROJECT_ID> <CLIENT_ID> <CLIENT_SECRET>");
  process.exit(1);
}

const PORT     = 3457;
const REDIRECT = `http://localhost:${PORT}`;
const authUrl  =
  `https://nestservices.google.com/partnerconnections/${PROJECT_ID}/auth` +
  `?redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&access_type=offline` +
  `&prompt=consent` +
  `&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent("https://www.googleapis.com/auth/sdm.service")}`;

console.log("\nOpening browser for Nest/SDM authorization…\n");
exec(`open "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  if (!code) { res.end("No code — close this tab."); return; }
  res.end("<h2>Authorization complete — you can close this tab.</h2>");
  server.close();

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT,
      grant_type:    "authorization_code"
    })
  });
  const d = await r.json();
  if (d.refresh_token) {
    console.log("✅  Success! Run these commands:\n");
    console.log(`netlify env:set NEST_PROJECT_ID "${PROJECT_ID}"`);
    console.log(`netlify env:set NEST_REFRESH_TOKEN "${d.refresh_token}"`);
    console.log("\nThen: netlify deploy --prod");
  } else {
    console.error("❌  Error:", JSON.stringify(d, null, 2));
  }
});
server.listen(PORT, () =>
  console.log(`Waiting for Google to redirect to http://localhost:${PORT} …`)
);
