# DylanBoard: project brief

Read this whole file before changing anything. It is the handoff from a long design chat in claude.ai. The code in this repo is a first slice. Several parts of the plan below are not built yet and some parts are unverified.

## 1. What this is

DylanBoard is a self-built replacement for Dylan's DAKboard wall display (dakboard.com). It is a single web page that runs full-screen on a Raspberry Pi connected to a 32" 1080p TV mounted in portrait orientation. It shows the family dashboard: clock, weather, to-dos, countdowns, stocks, a multi-calendar month view, photos, a security-camera still, an S&P 500 card, and news headlines.

- Owner: Dylan, who runs a deck-building business in Delafield, WI. Timezone: America/Chicago. He is comfortable in a terminal.
- Hosting: free Netlify tier, deployed from this GitHub repo (`dylanjstrube/dylanboard`). Every push to `main` should redeploy.
- Cost rule: stay on free tiers. Ask Dylan before adding anything paid. The one known exception is the one-time $5 Google Device Access fee for Nest (section 7).
- Privacy rule: the site is gated by a password. No calendar, to-do, or camera data may be served without a valid session cookie.

## 2. Display and design

- Target canvas: 1080 × 1920, portrait. `index.html` uses a fixed 1080×1920 "stage" that scales to the window (JS `fit()`), so it also previews on a laptop.
- Look: dark lake-dusk gradient background (navy to muted teal). Translucent dark cards with blur and rounded corners. Teal accent. Not the Stonehenge image from the old board. The approved design is `public/index.html`, which came from an approved mockup. Do not redesign it without asking.
- Stage layout, top to bottom (CSS grid rows `230px 300px 215px 700px 1fr`, padding 28px, gap 16px):
  1. Clock card (narrow, `.85fr`) + weather card (wide, `1.55fr`). Clock has no seconds. Weather shows current temp, "feels like", conditions, and a 5-day forecast. Each forecast day shows the day name, icon, precipitation chance, and the high temperature above the low.
  2. To Do card (left) and a right column holding a facts card (sunset, moon phase, wind, humidity, pressure, visibility) and a thermostat card with two Nest readings (1st floor, 2nd floor). Each reading has a status label: "🔥 HEATING" in orange when heat is on, "IDLE" in gray otherwise. Add a cooling state (❄️) for summer.
  3. A half-and-half row. Left: stock tickers, 16 of them in a 4×4 grid, small font, each showing symbol, price, and daily change %. Right: Countdowns card with 3 rows showing days only (no hours or minutes).
  4. Calendar card: legend (emoji + color + name per calendar) and a 5-week grid starting on the current week's Sunday. Events are colored chips with the calendar's emoji. All-day events come first, then timed events with short times such as `3p` or `3:30p`.
  5. Four equal tiles: photo slideshow, Blink camera still, S&P 500 card (current price plus a 7-day sparkline and a 1-year sparkline), CNN headlines.
- Readability: it is viewed from across a room. Keep fonts large and contrast high. Escape all text from external sources before inserting it into HTML (`esc()` in `board.js`).
- Dylan's choices, which must be preserved:
  - Calendars (up to 5; he currently has 4): Dylan (🏃‍♂️, teal `#4fc3b8`), Brooke (🐕, pink `#f48fb1`), Indoor Soccer (🏟️, amber `#ffd166`), Outdoor Soccer (⚽, green `#8bd17c`). Emoji and color for the last two are placeholders he may change.
  - Countdowns: Christmas (2026-12-25), Big Powderhorn Skiing (2027-01-21, he typed "1/21/26" and the year is assumed to be 2027; confirm), Noah Kahan Concert (2027-05-26).
  - Stock list to start with: ABNB, AMZN, BRK.B, DIS, DXCM, IDXX, NET, NFLX, NVDA, PYPL, ROKU, SHOP, SPOT, TSLA, VOO, ZM (16 fit; his old board had 24). Must be editable in the admin page. Live prices if performance allows; delayed is fine.

## 3. What exists in the repo now

```
netlify.toml          publish=public, functions=functions, esbuild bundler
package.json          deps: @netlify/blobs, ical.js (ESM project)
functions/
  _lib.mjs            HMAC session cookie sign/verify, authed(req), json(), Blobs store, DEFAULTS, getConfig()
  login.mjs           POST /api/login (password vs env BOARD_PASSWORD, sets HttpOnly cookie "board", 180 days)
  config.mjs          GET/PUT /api/config (auth required; GET strips calendar URLs unless ?admin)
  calendar.mjs        GET /api/calendar?from=ISO&to=ISO (auth required; fetches iCal feeds, expands recurrences)
public/
  index.html          approved mockup (still contains SAMPLE data in its inline script) + loads board.js
  board.js            live clock, countdowns, calendar legend and grid, ticker symbols from config
  login.html          password form
  admin.html          editor for calendars, tickers, countdowns; saves via PUT /api/config
```

Status: built and syntax-checked only. It has not been deployed or run against real calendars. First job is to get it running and fix whatever breaks.

### Config schema (stored in Netlify Blobs, store "board", key "config")
```json
{
  "calendars": [{ "name": "", "emoji": "", "color": "#rrggbb", "url": "https://...ics" }],
  "tickers": ["NVDA", "..."],
  "countdowns": [{ "name": "", "date": "YYYY-MM-DD" }]
}
```
Server-side validation lives in `config.mjs` (max 5 calendars, 16 tickers, 3 countdowns; `webcal://` is rewritten to `https://`). Extend the schema as new settings are added (refresh intervals, photo album URL, weather location, To Do list name, and so on). Keep the admin page as the single place to edit settings, so Dylan never has to redeploy.

### Auth
Single shared password in env `BOARD_PASSWORD`. Session token is `<expiryMs>.<hmac>` signed with env `SESSION_SECRET`, stored in an HttpOnly, Secure, SameSite=Lax cookie that lasts 180 days so the Pi stays logged in. All `/api/*` routes except login must call `authed(req)`. Static HTML is public but holds no data, and the board redirects to `/login.html` on a 401.

## 4. Known gaps in the current code (fix early)

1. Nothing has been run. Deploy, then test with real iCal feeds from Google, iCloud, and a generic link.
2. `public/index.html` still has the mockup's sample weather, thermostat, to-do, stocks, S&P, tiles, and fake calendar logic in its inline script. `board.js` overwrites the calendar, countdowns, legend, stocks, and clock. As each widget goes live, delete its sample code and sample markup.
3. Seed sensible `DEFAULTS.calendars` (the four calendars above, with empty URLs) so the legend is not blank before the admin page is used. Show a visible "no URL set" hint.
4. `calendar.mjs`: recurrence handling is simplified. Exceptions (RECURRENCE-ID) are skipped from the master series and added as their own events. Check this against a real feed with edited recurring events. Check timezones (VTIMEZONE registration) and floating times. Multi-day timed events only show on their first day. A calendar fetch failure is returned in `errors` but not shown on the board; surface a small warning on screen.
5. Calendar color and emoji are attached by calendar array index. If calendars are reordered or removed in admin, this stays correct because index comes from the same saved config. Keep it that way, or switch to ids.
6. No rate limiting on `/api/login`. Add basic throttling (for example a counter in Blobs).
7. DST and date math use `Math.round((a - b) / 864e5)` on local-midnight dates. Verify around the March and November clock changes.
8. The Pi's browser must have the right timezone. The clock and event times use the browser's local time.

## 5. Refresh behavior (per widget, no full page reloads)

Each widget polls on its own timer. Defaults should be editable in admin. One full `location.reload()` at about 03:00 each night picks up deploys and clears browser memory (already in `board.js`).

| Widget | Default refresh |
|---|---|
| Clock | 1 s, client-side |
| Calendars | 10 min |
| Weather | 10 min |
| Stocks and S&P price | 1 min during market hours (9:30 to 16:00 ET, Mon to Fri), 30 min otherwise |
| S&P charts | 15 min |
| To Do | 5 min |
| Nest | 5 min (Google rate-limits the API; do not go faster) |
| Blink still | 30 min |
| Photos | next photo every 30 s; re-fetch the album hourly |
| CNN headlines | 15 min |

Fetch from the browser only through this site's own `/api/*` functions. Functions keep third-party keys and tokens server-side, add caching, and avoid CORS problems.

## 6. Roadmap (suggested order; confirm with Dylan)

1. Deploy and verify the current slice. Fix bugs from section 4.
2. Weather (no key required): Open-Meteo for Delafield, WI (about 43.06 N, 88.41 W; confirm). Needs current temperature, apparent temperature, weather code to icon, wind, humidity, pressure, visibility, sunrise and sunset, daily high, low, and precipitation probability for 5 days. Convert to °F, mph, and inHg. Moon phase can be computed locally. Add a `/api/weather` function with a short cache.
3. Nest thermostats (see section 7). Show the heating state on each reading.
4. Stocks and S&P card (section 7). Ticker list comes from config.
5. Microsoft To Do (section 7).
6. Photo slideshow from an iCloud shared album (section 7).
7. CNN headlines (section 7).
8. Blink still (section 7).
9. Admin extras: refresh intervals, weather location, photo album URL, To Do list name; a "test this calendar" button that fetches a feed and shows the event count.
10. Pi kiosk setup docs: Chromium in kiosk mode, auto-start on boot, screen rotated to portrait, disable screen blanking, timezone America/Chicago, auto-recover from network loss. Put these in the README.

## 7. Integration notes (verify each against current docs before building)

- **Calendars**: all three source types work as plain iCal feeds, so no OAuth is needed. Google: calendar settings, "Secret address in iCal format". iCloud: a published calendar link (`webcal://p..-caldav.icloud.com/published/...`). Others: any `.ics` URL. These URLs act like passwords, so never log them, never return them from `/api/config` without `?admin`, and never commit them. A private (unpublished) iCloud calendar would need CalDAV with an app-specific password from appleid.apple.com. Do that only if Dylan asks, and store the password in a Netlify env var.
- **Nest**: official route is Google's Smart Device Management (SDM) API through Device Access. It requires a one-time $5 registration, a Google Cloud project with OAuth credentials, a Device Access project, and a one-time consent flow to obtain a refresh token. Store the client id, client secret, refresh token, and project id in env vars. Read the thermostat traits for ambient temperature (Celsius, convert to °F), humidity, and HVAC status (heating, cooling, or off). There are two thermostats, labeled 1st Floor and 2nd Floor; the mapping of device to label should be editable in admin. Cache for about 5 minutes.
- **Stocks**: Finnhub free tier (`/quote`) gives near-live quotes for US stocks. It likely does not include index data, so use SPY or VOO as a proxy for the S&P 500 headline price unless a free index source works. For the 7-day and 1-year charts, a free history source is needed (Twelve Data, Alpha Vantage, or Yahoo-style endpoints). Check free-tier limits and licensing, and cache aggressively. Show a stale marker when data is old or the market is closed. Hold keys in env vars.
- **Microsoft To Do**: Microsoft Graph, delegated permission `Tasks.Read`, via a free Azure app registration and a one-time sign-in to get a refresh token. Dylan's board shows one list of unchecked items, about 7 items visible. Which list to show should be a setting.
- **iCloud shared album photos**: Dylan chose a shared iCloud album because Amazon Photos has no public API. Shared albums have a public web-stream endpoint that is undocumented and unofficial (the album token comes from the share link). It may break. Proxy images through a function to avoid CORS, and cache. Cross-fade slides.
- **CNN**: use CNN's public RSS feed (for example the top-stories feed; check the current URL) and take the headline plus image from the feed items. Fall back gracefully if the feed is unavailable.
- **Blink**: no official API. Community libraries exist (for example `blinkpy` in Python; look for a maintained Node equivalent). Blink login uses 2FA and tokens expire. Netlify Functions cannot run Python, so likely design: a small script on the Pi (or another always-on machine) logs in, grabs a snapshot every 30 minutes, and uploads it to an authenticated endpoint on this site that stores it in Blobs, which the board then displays. Flag this as the riskiest feature and agree on the approach with Dylan before building.

## 8. Environment variables

Currently needed: `BOARD_PASSWORD`, `SESSION_SECRET` (set in the Netlify UI under Site configuration, Environment variables). Later: Nest, Microsoft, and stock-API keys. Document each new variable in the README. Never commit secrets or put them in client-side code. `.env` is git-ignored.

## 9. Local development

- `npm install`, then `npx netlify dev` runs the site and functions locally (Blobs works in dev mode). Create a local `.env` with `BOARD_PASSWORD` and `SESSION_SECRET`.
- Test the board at a 1080×1920 window or a scaled-down window, since the stage auto-scales.
- No framework or build step for the front end: plain HTML, CSS, and vanilla JS. Keep it that way unless there's a strong reason.

## 10. Working agreements

- Check in with Dylan before: paid services, new third-party accounts, changes to the approved visual design, or anything that moves secrets into the browser.
- Prefer small commits with clear messages, one integration at a time, each ending with a working deployed board.
- Explain any setup step Dylan must do himself (consent flows, API keys, Azure and Google console steps) in plain, numbered instructions.
- Keep `README.md` current with setup, env vars, and the Pi kiosk steps.

## 11. Open questions for Dylan

1. Confirm the Big Powderhorn skiing countdown year: 2027-01-21?
2. Final emoji and colors for the two soccer calendars.
3. Weather location: Delafield, WI center point, or his exact address? (Coordinates only; keep the address out of the repo.)
4. Which Microsoft To Do list should show?
5. Blink: is he okay with a Pi-side script uploading snapshots?
6. Does he want a cooling label for summer, and a night dimming mode?
