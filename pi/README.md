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

From the SSH session, run **one of the following**:

**Option A — Run directly from GitHub (once the repo is public):**
```bash
BOARD_URL=https://your-site.netlify.app \
  bash <(curl -fsSL https://raw.githubusercontent.com/dylanjstrube/dylanboard/main/pi/setup.sh)
```

**Option B — Clone the repo first:**
```bash
git clone https://github.com/dylanjstrube/dylanboard.git
BOARD_URL=https://your-site.netlify.app bash dylanboard/pi/setup.sh
```

Replace `https://your-site.netlify.app` with your actual Netlify URL.

The script takes **5–10 minutes** (mostly package downloads). Watch for any red errors; the last line should say `Setup complete`.

---

## Step 4 — Reboot

```bash
sudo reboot
```

After ~60 seconds, Chromium will start automatically in portrait kiosk mode and load your board URL.

---

## Step 5 — Log in to DylanBoard (one time)

The first time Chromium opens, it will show the DylanBoard login page. You need to enter the board password once. After that the 180-day session cookie keeps the Pi logged in automatically.

**How to reach the login page on a kiosk display with no keyboard:**

Option A — Plug a USB keyboard into the Pi via a micro-USB OTG adapter, press `Ctrl+Alt+F2` to open a second terminal, log in, and enter:
```bash
DISPLAY=:0 xdg-open https://your-site.netlify.app/login.html
```

Option B — From your Mac, open the site in your own browser, log in there, and confirm it works. Then on the Pi:
```bash
ssh dylan@dylanboard.local
DISPLAY=:0 chromium-browser --kiosk https://your-site.netlify.app/login.html &
```

After logging in once and seeing the board, you're done. The Pi stays logged in.

---

## Troubleshooting

### Display is upside-down
Edit the autostart file and change `left` to `right`:
```bash
nano ~/.config/openbox/autostart
# change: xrandr --output HDMI-1 --rotate left
# to:     xrandr --output HDMI-1 --rotate right
```
Then restart X: `sudo reboot`

### Chromium won't start / black screen
Check the X11 log:
```bash
cat /tmp/x11.log
cat /tmp/chromium.log
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
| `chromium-browser` | The kiosk browser |
| `xserver-xorg` + `xinit` | Minimal X11 display server |
| `x11-xserver-utils` | `xrandr`, `xset` for rotation and blanking |
| `openbox` | Lightweight window manager (needed to host Chromium in X) |
| `unclutter` | Hides the mouse cursor |
| `xdotool` | Utility for scripting the display (optional) |
| `fonts-noto-color-emoji` | Emoji rendering (the board uses emoji heavily) |
