# DylanBoard: project brief

Read this whole file before changing anything.

## 1. What this is

DylanBoard is a self-built replacement for Dylan's DAKboard wall display. It is a single web page that runs full-screen on a Raspberry Pi connected to a 32" 1080p TV mounted in portrait orientation. It shows the family dashboard: clock, weather, to-dos, countdowns, stocks, a multi-calendar month view, photos, a Blink security-camera still, an S&P 500 card, and news headlines.

- Owner: Dylan, who runs a deck-building business in Delafield, WI. Timezone: America/Chicago.
- Hosting: free Netlify tier, deployed from GitHub repo `dylanjstrube/dylanboard`. Every push to `main` redeploys.
- Cost rule: stay on free tiers. Ask Dylan before adding anything paid. Known paid exceptions: Google Device Access one-time $5 fee (Nest).
- Privacy rule: the site is gated by a password. No calendar, to-do, or camera data may be served without a valid session cookie.

## 2. Display and design

- Target canvas: 1080 × 1920, portrait. `index.html` uses a fixed 1080×1920 "stage" that scales to the window (JS `fit()`).
- Look: dark lake-dusk gradient background (navy to muted teal). Translucent dark cards with blur and rounded corners. Teal accent (`#4fc3b8`).
- Stage layout (CSS grid rows `230px 300px 215px 700px 1fr`, padding 28px, gap 16px), top to bottom:
  1. Clock card (`.85fr`) + weather card (`1.55fr`). No seconds. Weather: temp, feels-like, 5-day forecast with icon, precip%, high/low.
  2. S&P 500 card (left) + To Do card (center) + right column (facts card: sunset/moon/wind/humidity/pressure/visibility; thermostat card: two Nest readings).
  3. Stocks (4×4 grid, 16 tickers) + Countdowns (3 rows, days only).
  4. Calendar: legend + 5-week grid starting on current Sunday. Colored event chips.
  5. Four tiles: photo slideshow, Blink camera still, (unused), news headlines.
- Dylan's choices (must be preserved):
  - Calendars: Dylan (🏃‍♂️ `#4fc3b8`), Brooke (🐕 `#f48fb1`), Indoor Soccer (🏟️ `#ffd166`), Outdoor Soccer (⚽ `#8bd17c`).
  - Countdowns: Christmas 2026-12-25, Big Powderhorn Skiing 2027-01-21, Noah Kahan Concert 2027-05-26.
  - 16 stock tickers: ABNB, AMZN, BRK.B, DIS, DXCM, IDXX, NET, NFLX, NVDA, PYPL, ROKU, SHOP, SPOT, TSLA, VOO, ZM.

## 3. Current file structure

```
netlify.toml              publish=public, functions=functions, esbuild bundler
package.json              deps: @netlify/blobs, ical.js (ESM project)
.env.example              all environment variables documented (copy to .env for local dev)
functions/
  _lib.mjs                HMAC session cookie sign/verify, authed(req), json(), store(), DEFAULTS, getConfig()
  login.mjs               POST /api/login
  config.mjs              GET/PUT /api/config (GET strips calendar URLs unless ?admin)
  calendar.mjs            GET /api/calendar?from=ISO&to=ISO
  weather.mjs             GET /api/weather (Open-Meteo, no key required)
  nest.mjs                GET /api/nest (Google SDM API)
  stocks.mjs              GET /api/stocks (Finnhub quotes + Yahoo Finance charts)
  todos.mjs               GET /api/todos (Google Tasks API)
  headlines.mjs           GET /api/headlines (BBC RSS, no key)
  photos.mjs              GET /api/photos (iCloud shared album)
  photos-cron.mjs         Scheduled every 2h — fetches iCloud album manifest into Blobs
  camera.mjs              GET /api/camera (reads Blink JPEG from Blobs)
  blink-auth.mjs          POST /api/blink-auth (Blink OAuth v2 PKCE login/verify/status/disconnect)
  blink-cron.mjs          Scheduled every 5min — requests on-demand Blink snapshot, downloads thumbnail
  admin-seed-photos.mjs   Dev-only endpoint to seed photo_meta Blob locally
public/
  index.html              The board (approved design, some inline sample data remains)
  board.js                All live widget logic (clock, weather, calendar, stocks, camera, etc.)
  login.html              Password form → POST /api/login
  admin.html              Config editor (calendars, tickers, countdowns, Blink login)
```

## 4. Status of each widget

All widgets are built and tested locally. The site has not been deployed to production yet (Netlify free-tier deploy quota exhausted; resets 2026-12-01).

| Widget | Status | Notes |
|---|---|---|
| Clock | ✅ Live | Client-side, 1s tick |
| Weather | ✅ Live | Open-Meteo, Delafield WI (43.0633, -88.4134), no key |
| Nest thermostats | ✅ Live | Google SDM API, 5-min cache; needs 4 env vars |
| Stocks / S&P | ✅ Live | Finnhub quotes + Yahoo Finance charts; needs FINNHUB_KEY |
| To Do | ✅ Live | Google Tasks API; needs 3 env vars |
| Calendar | ✅ Live | iCal feeds; URLs set in admin. Currently empty (no URLs configured locally) |
| Photos | ✅ Live | iCloud shared album; needs ICLOUD_ALBUM_TOKEN |
| Headlines | ✅ Live | BBC RSS, no key; falls back gracefully |
| Blink camera | ✅ Live | On-demand snapshots every 5 min; Blink login via admin page |
| Countdowns | ✅ Live | Days only; from config |
| S&P sparklines | ✅ Live | 7-day and 1-year charts via Yahoo Finance |

## 5. Auth and sessions

Single shared password in env `BOARD_PASSWORD`. Session token is `<expiryMs>.<hmac>` signed with `SESSION_SECRET`, stored in an HttpOnly/Secure/SameSite=Lax cookie lasting 180 days. All `/api/*` routes except `/api/login` call `authed(req)`. Board redirects to `/login.html` on 401.

## 6. Config schema (Netlify Blobs, store "board", key "config")

```json
{
  "calendars": [{ "name": "", "emoji": "", "color": "#rrggbb", "url": "https://...ics" }],
  "tickers": ["NVDA", "..."],
  "countdowns": [{ "name": "", "date": "YYYY-MM-DD" }]
}
```

Edited exclusively via `/admin.html`. Validation: max 5 calendars, 16 tickers, 3 countdowns. `webcal://` is rewritten to `https://`. Calendar URLs are secret — never logged, never returned from `/api/config` without `?admin`.

## 7. Netlify Blobs (store "board")

All keys live in the `board` store. This data is NOT in the git repo — it must be re-configured after a fresh deploy.

| Key | Type | Set by | Contents |
|---|---|---|---|
| `config` | JSON | admin.html | Calendars, tickers, countdowns |
| `blink_auth` | JSON | admin.html (Blink login) | Blink OAuth tokens, accountId, tier, hardwareId |
| `blink_image` | ArrayBuffer | blink-cron | Latest Blink camera JPEG |
| `blink_meta` | JSON | blink-cron | thumbUrl, cameraName, updatedAt, snapUpdatedAt |
| `photo_meta` | JSON | photos-cron | Array of `{guid, checksum}` for iCloud photos |
| `blink_pending` | JSON | blink-auth (temp) | AES-256-GCM encrypted credentials during 2FA; auto-deleted after verify |

## 8. Environment variables

See `.env.example` for the full annotated list. Summary:

**Required (board won't work without these):**
- `BOARD_PASSWORD` — the password Dylan types to log in
- `SESSION_SECRET` — long random string used to sign session cookies

**Optional — features degrade gracefully when missing:**
- `FINNHUB_KEY` — Finnhub API key; stocks show `—` without it
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — shared OAuth client for Nest + Google Tasks
- `NEST_REFRESH_TOKEN` / `NEST_PROJECT_ID` — Nest thermostat access
- `GOOGLE_TASKS_REFRESH_TOKEN` / `GOOGLE_TASKS_LIST_ID` — Google Tasks (To Do)
- `ICLOUD_ALBUM_TOKEN` — token from iCloud shared album URL; photos are blank without it

Blink credentials are NOT stored in env vars — they live in the `blink_auth` Blob, set via admin.

## 9. Integration notes

### Calendars
iCal feeds only — no OAuth needed. Google: calendar settings → "Secret address in iCal format". iCloud: `webcal://p..-caldav.icloud.com/published/...`. These URLs are passwords — never commit them, never log them.

### Weather
Open-Meteo, free, no key. Location hardcoded in `weather.mjs`: `43.0633, -88.4134` (Delafield WI center). No setup needed.

### Nest
Google Smart Device Management (SDM) API. Requires a one-time $5 Google Device Access registration. Setup steps Dylan must do himself:
1. Create a Google Cloud project, enable Smart Device Management API.
2. Create OAuth credentials (Web app type). Save `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Register a Device Access project at console.nest.google.com ($5 fee). Save `NEST_PROJECT_ID`.
4. Run the OAuth consent flow to get a refresh token. Save as `NEST_REFRESH_TOKEN`.
The same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are reused for Google Tasks.

### Stocks
Finnhub free tier (`/quote` endpoint) for US stock quotes. S&P 500 is proxied as VOO. 7-day and 1-year sparklines use Yahoo Finance's undocumented public chart API (no key). Cache: quotes 1 min during market hours, 30 min otherwise; charts 15 min.

### To Do
Google Tasks API (changed from original plan of Microsoft To Do — simpler, reuses same Google OAuth client as Nest). Dylan must do a one-time consent flow:
1. Reuse `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from the Nest setup.
2. Add `https://www.googleapis.com/auth/tasks.readonly` to the OAuth scopes.
3. Run the consent flow; save the refresh token as `GOOGLE_TASKS_REFRESH_TOKEN`.
4. Optionally set `GOOGLE_TASKS_LIST_ID` to a specific list ID (defaults to `@default`, i.e., the first list).

### iCloud Photos
iCloud shared album (undocumented web API). `ICLOUD_ALBUM_TOKEN` is the token at the end of the share URL (e.g., `https://www.icloud.com/photos/#B0a1b2c3d4e5f6` → token is `B0a1b2c3d4e5f6`). `photos-cron.mjs` fetches the full album manifest (slow, ~50s) every 2 hours and stores it in Blobs. `photos.mjs` uses the cached manifest to get CDN URLs quickly (< 2s). The API may change without notice.

### Headlines
BBC RSS (`https://feeds.bbci.co.uk/news/rss.xml`). No key. No setup. Falls back to empty with no crash. Changed from CNN (CNN's RSS is unreliable).

### Blink camera
Full OAuth v2 PKCE flow implemented in `blink-auth.mjs`. Dylan logs in via `/admin.html` — the page handles email/password entry and the 2FA PIN. Tokens are stored in the `blink_auth` Blob. `blink-cron.mjs` runs every 5 minutes:
1. Gets camera info from homescreen API (`GET /api/v3/accounts/{id}/homescreen`).
2. Requests an on-demand snapshot (`POST /network/{nid}/camera/{cid}/thumbnail`) — confirmed working on free plan.
3. Waits 8 seconds for the camera to respond.
4. Re-reads homescreen, downloads the new thumbnail, stores JPEG in Blobs.
The `blink_auth` Blob is refreshed automatically; re-auth is only needed if the token is fully revoked. Blink free plan does not expose motion event clips via API (they stay on the Sync Module SD card); on-demand snapshots are the workaround.

## 10. Refresh intervals (board.js)

| Widget | Poll interval | Notes |
|---|---|---|
| Clock | 1 s | Client-side only |
| Calendars | 10 min | `/api/calendar` |
| Weather | 10 min | `/api/weather` |
| Stocks + S&P price | 1 min (market hours) / 30 min | `/api/stocks` |
| S&P charts | 15 min | Included in `/api/stocks` response |
| To Do | 5 min | `/api/todos` |
| Nest | 5 min | `/api/nest` |
| Blink camera | 5 min | `/api/camera?t=timestamp` (cache-busted) |
| Photos | Slideshow: 10 min per slide; manifest: 1 hr | `/api/photos` |
| Headlines | 15 min | `/api/headlines` |

The page does a full `location.reload()` at 03:00 each night to pick up new deploys.

## 11. Local development

```bash
cd dylanboard
npm install
cp .env.example .env        # then fill in real values
npx netlify dev             # starts on http://localhost:8888
```

Netlify Blobs works in dev mode (uses a local `.netlify/blobs` directory). Scheduled functions (blink-cron, photos-cron) do NOT run automatically in dev — invoke them manually:

```bash
netlify functions:invoke blink-cron
netlify functions:invoke photos-cron
```

## 12. Deploying to a new Netlify account

1. Push the repo to GitHub (or fork `dylanjstrube/dylanboard`).
2. In Netlify: **Add new site → Import from Git**. Select the repo. Build settings are in `netlify.toml` — no changes needed.
3. In Netlify → **Site configuration → Environment variables**, add all variables from `.env.example` with real values.
4. Click **Deploy site**. The first deploy takes ~1 minute.
5. After deploy, visit `https://<your-site>.netlify.app/login.html` and log in.
6. Visit `/admin.html` to configure:
   - Calendar iCal URLs for each family member.
   - Stock tickers (pre-seeded with defaults).
   - Countdowns (pre-seeded with defaults).
   - Blink camera login (email + password + 2FA PIN).
7. The `photos-cron` runs automatically within 2 hours and populates the photo slideshow. To seed it immediately, invoke it manually from the Netlify Functions tab or run the `admin-seed-photos` endpoint.
8. The `blink-cron` starts immediately after Blink login.

**Data that must be re-configured after a fresh deploy (not in git):**
- Calendar URLs (via admin.html)
- Blink credentials (via admin.html)
- All Blobs are empty on a fresh account; `blink_image` / `blink_meta` populate within 5 minutes of Blink login; `photo_meta` within 2 hours.

## 13. Pi kiosk setup (TODO)

Steps needed: Chromium in kiosk mode, auto-start on boot, screen rotated portrait, disable blanking, timezone America/Chicago, auto-recover from network loss. Document in README when doing this step.

## 14. Open questions

1. Final emoji + colors for the two soccer calendars.
2. Which Google Tasks list to show (configure `GOOGLE_TASKS_LIST_ID`).
3. Is Squirrel Box wired or battery-powered? (5-min cron wakes it every cycle; could drain a battery camera faster.)
4. Night dimming mode?
5. Pi kiosk setup — when is this needed?
