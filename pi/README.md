# DylanBoard Pi Zero 2 W Kiosk

This turns a fresh Raspberry Pi Zero 2 W into a dedicated kiosk that loads your DylanBoard site full-screen in portrait mode with no toolbars, auto-starts on boot, and auto-recovers from crashes or network outages.

---

## What you need

| Item | Notes |
|------|-------|
| Raspberry Pi Zero 2 W | Your existing DAKboard CPU mini |
| microSD card | 8 GB minimum; 16 GB recommended |
| micro HDMI → HDMI cable | The Zero 2 W has a micro HDMI port |
| A Mac or PC to flash the card | Raspberry Pi Imager (free) |
| Your home Wi-Fi SSID and password | Entered in the imager |

---

## Step 1 — Flash the SD card

1. Download and install **Raspberry Pi Imager**: https://www.raspberrypi.com/software/
2. Open Imager, click **Choose Device** → **Raspberry Pi Zero 2 W**.
3. Click **Choose OS** → **Raspberry Pi OS (other)** → **Raspberry Pi OS Lite (64-bit)**.
   - Lite = no desktop GUI pre-installed (the setup script adds only what's needed).
4. Click **Choose Storage** → select your microSD card.
5. Click the **gear / settings icon** (or press Ctrl+Shift+X) and configure:
   - **Hostname**: `dylanboard` (or anything you like)
   - **Enable SSH** ✓ — Use password authentication
   - **Set username and password**: e.g., `dylan` / a strong password
   - **Wi-Fi SSID and password**: your home network
   - **Locale / timezone**: `America/Chicago` / keyboard `us`
6. Click **Save**, then **Write**. Wait for it to finish and verify.

---

## Step 2 — Boot and SSH in

1. Insert the microSD into the Pi Zero 2 W.
2. Connect the Pi to power (micro USB). It takes about 90 seconds to boot the first time.
3. Find its IP address. Options:
   - Your router's device list (look for `dylanboard`).
   - `ping dylanboard.local` from your Mac terminal.
4. SSH in:
   ```bash
   ssh dylan@dylanboard.local
   ```
   (replace `dylan` with the username you chose)

---

## Step 3 — Run the setup script

> **Note:** the process substitution form (`bash <(curl ...)`) does not work with `sudo` on Pi OS. Download the script first, then run it.

```bash
curl -fsSL https://raw.githubusercontent.com/dylanjstrube/dylanboard/main/pi/setup.sh -o setup.sh
```

```bash
BOARD_URL=https://dylanboard.netlify.app sudo -E bash setup.sh
```

The script takes **5–10 minutes** (mostly package downloads). Watch for any red errors; the last line should say `Setup complete`.

---

## Step 4 — Reboot

```bash
sudo reboot
```

After ~60 seconds, Chromium will start automatically in portrait kiosk mode and load your board URL.

---

## Step 5 — Log in to DylanBoard (one time)

The Pi browser has no session cookie until you log in once. The 180-day cookie then keeps it logged in through reboots automatically.

**Option A — Physical keyboard/mouse (easiest)**

Plug a USB keyboard+mouse into the Pi's **USB data port** (the middle micro-USB port — not the PWR port nearest the corner). The board will show the login page. Type your password and submit.

> ⚠️ Pi Zero 2 W USB ports: the port nearest the board edge is **PWR only**. The middle port is the **USB data port** that accepts keyboards, mice, and OTG adapters.

**Option B — Inject the session cookie via SSH**

If you have no keyboard, use `curl` from the Pi's SSH session to log in and inject the cookie directly into Chromium's profile:

1. Kill Chromium:
   ```bash
   pkill -f chromium; sleep 2
   ```

2. Get a session cookie (replace `YOURPASSWORD`):
   ```bash
   curl -c /tmp/cookies.txt -X POST https://dylanboard.netlify.app/api/login \
     -H "Content-Type: application/json" \
     -d '{"password":"YOURPASSWORD"}' -v 2>&1 | grep -i 'set-cookie\|< HTTP'
   ```
   Copy the long token value from the `set-cookie: board=…` line.

3. Write the cookie into Chromium's database (replace `TOKEN_VALUE` with the value you copied):
   ```bash
   python3 << 'EOF'
   import sqlite3, time, os
   db = os.path.expanduser("~/.config/chromium-kiosk/Default/Cookies")
   cookie_value = "TOKEN_VALUE"
   epoch_offset = 11644473600 * 1000000
   now = int(time.time() * 1000000) + epoch_offset
   expires = now + (15552000 * 1000000)
   con = sqlite3.connect(db)
   cur = con.cursor()
   cur.execute("DELETE FROM cookies WHERE host_key='dylanboard.netlify.app' AND name='board'")
   cur.execute("""INSERT INTO cookies
     (creation_utc,host_key,top_frame_site_key,name,value,encrypted_value,
      path,expires_utc,is_secure,is_httponly,last_access_utc,has_expires,
      is_persistent,priority,samesite,source_scheme,source_port,
      last_update_utc,source_type,has_cross_site_ancestor)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
     (now,"dylanboard.netlify.app","","board",cookie_value,b"",
      "/",expires,1,1,now,1,1,1,1,2,443,now,0,0))
   con.commit(); con.close()
   print("Cookie written successfully")
   EOF
   ```

4. Reboot:
   ```bash
   sudo reboot
   ```

---

## Troubleshooting

### Clock shows wrong date after reboot
The Pi Zero 2 W has no battery-backed RTC. It syncs time via NTP on boot. If the date is wrong, check sync status:
```bash
timedatectl
```
If `NTP service: inactive`, enable it:
```bash
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd
```
The clock corrects itself within a minute once the network is up.

### Text looks bigger or wider than on a Mac
The board's CSS asks for the Inter font. A Mac falls back to Apple's San Francisco font, but a bare Pi has neither, so Chromium falls back to DejaVu Sans. DejaVu is much wider, which makes text wrap and look oversized.

Check that Inter is installed: `fc-match Inter` should print `Inter`, not `DejaVu Sans`. If it doesn't, install it:
```bash
sudo apt-get install fonts-inter
```
If you can't use `sudo`, install it for the kiosk user only:
```bash
d=$(mktemp -d) && cd $d && apt-get download fonts-inter && dpkg-deb -x fonts-inter_*.deb x
mkdir -p ~/.local/share/fonts && find x -name "*.otf" ! -iname "*italic*" -exec cp {} ~/.local/share/fonts/ \;
fc-cache -f && cd && rm -rf $d
```
Then restart Chromium with `pkill -f "[c]hromium --kiosk"` (the kiosk loop relaunches it within a few seconds).

How the board's fonts are set up (in `public/index.html`):
- Body text uses **Inter**. Large text (clock, date, temperatures, countdowns, facts card values) uses **Inter Display**, Inter's more tightly spaced version for big sizes. That matches how macOS switches to SF Pro Display at large sizes.
- **Noto Color Emoji** is listed before the system fallback font. Without that, DejaVu Sans's black-and-white glyphs win for some emoji, such as the 🌕 moon phases.
- None of these fonts exist on a Mac, so the Mac rendering is unaffected.

### Emoji look different from the Mac
The Pi uses Google's Noto emoji and the Mac uses Apple's. Apple's emoji font only exists on Apple devices, so this difference is expected.

### Image looks soft or slightly zoomed on the TV
Use `DISPLAY=:0 scrot /tmp/s.png` to screenshot what the Pi actually renders. If the screenshot is sharp, the TV is rescaling the image. In the TV's picture settings, set the picture size to "Just Scan", "Screen Fit", "Full Pixel" or "1:1" (the name varies by brand), and turn sharpness down to around 0.

### Display is upside-down
Edit the autostart file and change `left` to `right`:
```bash
nano ~/.config/openbox/autostart
# change: xrandr --output HDMI-1 --rotate left
# to:     xrandr --output HDMI-1 --rotate right
```
Then restart X: `sudo reboot`

### Chromium won't start / white or black screen
Check the X11 and Chromium logs:
```bash
cat /tmp/x11.log
cat /tmp/chromium.log
```
Multiple Chromium instances competing for RAM (512 MB on Pi Zero 2 W) will cause white screens. Kill all instances and let only the kiosk.sh loop run:
```bash
pkill -f chromium
sudo reboot
```

### Display is 1080×1920 but the board content is small or misaligned
The `fit()` function in `board.js` scales the 1080×1920 stage to the window. If xrandr reports a different resolution, force 1080p in `/boot/firmware/config.txt`:
```
hdmi_group=1
hdmi_mode=16
```

### Wi-Fi drops and the board shows a network error
The kiosk wrapper script (`~/kiosk.sh`) automatically restarts Chromium after a 5-second pause whenever it crashes. If the network is just slow to reconnect, board.js refreshes each widget on its own timer — the board recovers on the next poll without a full reload.

### Manually update the board URL
```bash
nano ~/kiosk.sh   # change the BOARD_URL line
sudo reboot
```

---

## Daily reload

`board.js` calls `location.reload()` at ~3:00 AM each night. This picks up any new Netlify deployments and clears Chromium's memory. No configuration needed.

---

## Photo slideshow rotation

The Photos tile shows **5 photos per day** from the iCloud shared album, changing every 10 minutes and looping through those 5 all day.

- The daily set changes at **midnight Chicago time** (America/Chicago). It used to change at 6 PM because the code used the UTC date, so the evening's photos repeated the next morning. That's fixed.
- The album is put into one fixed shuffled order, and each day takes the next 5 photos. **No photo repeats until the whole album has been shown.** With 625 photos, that's about 125 days.
- New photos added to the album slot into that order without reshuffling it.
- The album list is refreshed every 2 hours by `photos-cron`. To show more photos per day, change `PICK_COUNT` in `functions/photos.mjs`.

---

## Display schedule

The setup script automatically configures the display to **turn off at 11:00 PM and back on at 6:00 AM** (America/Chicago).

To change the times, edit the kiosk user's crontab:
```bash
crontab -e
```
The two relevant lines look like:
```
0 23 * * * DISPLAY=:0 xset dpms force off
0  6 * * * DISPLAY=:0 xset dpms force on
```
The first number is the minute, the second is the hour (24-hour). Change `23` and `6` to whatever you prefer.

---

## Package summary

The setup script installs only these packages on top of Raspberry Pi OS Lite:

| Package | Purpose |
|---------|---------|
| `chromium` | The kiosk browser |
| `xserver-xorg` + `xinit` | Minimal X11 display server |
| `x11-xserver-utils` | `xrandr`, `xset` for rotation and blanking |
| `openbox` | Lightweight window manager (needed to host Chromium in X) |
| `unclutter` | Hides the mouse cursor |
| `xdotool` | Utility for scripting the display (optional) |
| `fonts-noto-color-emoji` | Emoji rendering (the board uses emoji heavily) |
| `fonts-inter` | The board's primary font; without it Chromium falls back to the much wider DejaVu Sans and text looks oversized |
