#!/usr/bin/env node
// Seed the Netlify Blobs photo_meta cache by calling the iCloud API.
// Run this once after first deploy to populate photos before the cron fires:
//   netlify dev:exec node scripts/seed-photos.mjs
//   (or just: node scripts/seed-photos.mjs  — it also falls back to printing JSON)
import { readFileSync } from "node:fs";

try {
  const env = readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const TOKEN = process.env.ICLOUD_ALBUM_TOKEN;
if (!TOKEN) { console.error("ICLOUD_ALBUM_TOKEN not set"); process.exit(1); }

async function icloudPost(path, body) {
  let host = "p23-sharedstreams.icloud.com";
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "https://www.icloud.com" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.status === 330) {
      const d = await r.json();
      host = d["X-Apple-MMe-Host"] || host;
      console.log(`  → redirect to ${host}`);
      continue;
    }
    if (!r.ok) throw new Error(`iCloud ${path} → ${r.status}`);
    return r.json();
  }
  throw new Error("iCloud redirect loop");
}

function bestChecksum(photo) {
  return Object.values(photo.derivatives || {})
    .filter((d) => d.checksum && +d.fileSize > 10_000 && +d.fileSize < 2_000_000)
    .sort((a, b) => +b.fileSize - +a.fileSize)[0]?.checksum ?? null;
}

console.log("Fetching webstream (may take ~60s)…");
const start = Date.now();
const stream = await icloudPost(`/${TOKEN}/sharedstreams/webstream`, { streamCtag: null });
console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);

const photos = (stream.photos || [])
  .filter((p) => !/video/i.test(p.mediaAssetType || ""))
  .map((p) => ({ guid: p.photoGuid, checksum: bestChecksum(p) }))
  .filter((p) => p.checksum);

console.log(`Found ${photos.length} photos`);
const payload = { photos, updatedAt: Date.now() };

const payloadJson = JSON.stringify(payload);

// Save to a temp file and use netlify blobs:set --input
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpFile = join(tmpdir(), "dylanboard-photo-meta.json");
writeFileSync(tmpFile, payloadJson);
console.log(`Saved JSON to ${tmpFile}`);

try {
  execSync(`netlify blobs:set board photo_meta --input "${tmpFile}"`, { stdio: "inherit" });
  console.log("✅  Saved to Netlify Blobs");
} catch (e) {
  console.log("netlify blobs:set failed:", e.message);
  console.log("Try running manually:");
  console.log(`  netlify blobs:set board photo_meta --input "${tmpFile}"`);
}
