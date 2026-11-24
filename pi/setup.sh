#!/usr/bin/env bash
# DylanBoard Pi Zero 2 W Kiosk Setup
# Run once on a fresh Raspberry Pi OS Lite (64-bit) install:
#   bash <(curl -fsSL https://raw.githubusercontent.com/dylanjstrube/dylanboard/main/pi/setup.sh)
# Or after cloning: bash pi/setup.sh
#
# Set BOARD_URL before running if you know the deployed URL:
#   BOARD_URL=https://your-site.netlify.app bash pi/setup.sh

set -euo pipefail

BOARD_URL="${BOARD_URL:-https://dylanboard.netlify.app}"
KIOSK_USER="${SUDO_USER:-${USER:-pi}}"
KIOSK_HOME=$(eval echo "~$KIOSK_USER")

echo "==> DylanBoard kiosk setup"
echo "    User:     $KIOSK_USER"
echo "    Home:     $KIOSK_HOME"
echo "    URL:      $BOARD_URL"
echo ""

# ---------------------------------------------------------------------------
# 1. System update + packages
# ---------------------------------------------------------------------------
echo "==> Installing packages (this takes a few minutes)..."
apt-get update -qq
apt-get install -y --no-install-recommends \
  chromium \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  openbox \
  unclutter \
  xdotool \
  fonts-noto-color-emoji \
  ca-certificates \
  curl \
  htop

# ---------------------------------------------------------------------------
# 2. Timezone
# ---------------------------------------------------------------------------
echo "==> Setting timezone to America/Chicago..."
timedatectl set-timezone America/Chicago
timedatectl set-ntp true

# ---------------------------------------------------------------------------
# 3. Display: force 1080p over HDMI and rotate to portrait via xrandr
#    (xrandr rotation works without touching kernel config)
# ---------------------------------------------------------------------------
CONFIG_FW="/boot/firmware/config.txt"   # Bookworm
CONFIG_OLD="/boot/config.txt"            # Bullseye and earlier
BOOT_CFG=""
[[ -f "$CONFIG_FW" ]] && BOOT_CFG="$CONFIG_FW"
[[ -z "$BOOT_CFG" && -f "$CONFIG_OLD" ]] && BOOT_CFG="$CONFIG_OLD"

if [[ -n "$BOOT_CFG" ]]; then
  echo "==> Configuring HDMI in $BOOT_CFG..."
  # Remove any old display_rotate lines first
  sed -i '/^display_rotate/d' "$BOOT_CFG"
  # Force HDMI output even with no monitor connected at boot
  grep -qx 'hdmi_force_hotplug=1' "$BOOT_CFG" || echo 'hdmi_force_hotplug=1' >> "$BOOT_CFG"
  # 1080p 60 Hz (CEA mode 16)
  grep -qx 'hdmi_group=1' "$BOOT_CFG" || echo 'hdmi_group=1' >> "$BOOT_CFG"
  grep -qx 'hdmi_mode=16'  "$BOOT_CFG" || echo 'hdmi_mode=16'  >> "$BOOT_CFG"
  # HDMI signal (required for audio and proper handshake with TVs)
  grep -qx 'hdmi_drive=2'  "$BOOT_CFG" || echo 'hdmi_drive=2'  >> "$BOOT_CFG"
fi

# ---------------------------------------------------------------------------
# 4. Auto-login to console (systemd getty override)
# ---------------------------------------------------------------------------
echo "==> Enabling console autologin for $KIOSK_USER..."
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
systemctl daemon-reload
systemctl enable getty@tty1

# ---------------------------------------------------------------------------
# 5. Start X on login
# ---------------------------------------------------------------------------
echo "==> Setting up ~/.bash_profile to start X..."
PROFILE="$KIOSK_HOME/.bash_profile"
# Remove any old startx lines
grep -v 'startx' "$PROFILE" 2>/dev/null > /tmp/_profile || true
cat > "$PROFILE" <<'EOF'
# Start X on tty1 login (kiosk mode)
if [[ -z "$DISPLAY" && "$(tty)" == "/dev/tty1" ]]; then
  exec startx -- -nocursor 2>/tmp/x11.log
fi
EOF
chown "$KIOSK_USER:$KIOSK_USER" "$PROFILE"

# ---------------------------------------------------------------------------
# 6. Openbox autostart: rotate display, disable blanking, launch Chromium
# ---------------------------------------------------------------------------
echo "==> Writing openbox autostart..."
AUTOSTART_DIR="$KIOSK_HOME/.config/openbox"
mkdir -p "$AUTOSTART_DIR"
chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config"

cat > "$AUTOSTART_DIR/autostart" <<AUTOSTART
#!/bin/bash

# Rotate display to portrait (clockwise = "left" in xrandr terms).
# Change "left" to "right" if the image is upside-down.
xrandr --output HDMI-1 --rotate left || \
xrandr --output HDMI-A-1 --rotate left || true

# Disable screensaver, DPMS power management, and display blanking
xset s off
xset -dpms
xset s noblank

# Hide mouse cursor after 1 s of inactivity
unclutter -idle 1 -root &

# Launch kiosk wrapper (handles retries + crash recovery)
/home/${KIOSK_USER}/kiosk.sh &
AUTOSTART
# Replace literal ${KIOSK_USER} inside the heredoc
sed -i "s|\${KIOSK_USER}|${KIOSK_USER}|g" "$AUTOSTART_DIR/autostart"
chmod +x "$AUTOSTART_DIR/autostart"
chown "$KIOSK_USER:$KIOSK_USER" "$AUTOSTART_DIR/autostart"

# ---------------------------------------------------------------------------
# 7. Minimal ~/.xinitrc that starts openbox
# ---------------------------------------------------------------------------
cat > "$KIOSK_HOME/.xinitrc" <<'EOF'
exec openbox-session
EOF
chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.xinitrc"

# ---------------------------------------------------------------------------
# 8. Kiosk wrapper script: waits for network, retries Chromium on crash
# ---------------------------------------------------------------------------
echo "==> Writing ~/kiosk.sh..."
cat > "$KIOSK_HOME/kiosk.sh" <<KIOSK
#!/bin/bash
BOARD_URL="${BOARD_URL}"
PROFILE_DIR="\$HOME/.config/chromium-kiosk"

# Wait up to 60 s for network
for i in \$(seq 1 30); do
  curl -sf --max-time 2 "\$BOARD_URL" -o /dev/null && break
  sleep 2
done

while true; do
  chromium \\
    --kiosk \\
    --noerrdialogs \\
    --disable-infobars \\
    --no-first-run \\
    --disable-pinch \\
    --overscroll-history-navigation=0 \\
    --check-for-update-interval=31536000 \\
    --disable-features=TranslateUI \\
    --disable-session-crashed-bubble \\
    --disable-restore-session-state \\
    --password-store=basic \\
    --user-data-dir="\$PROFILE_DIR" \\
    --window-size=1080,1920 \\
    "\$BOARD_URL" \\
    2>/tmp/chromium.log
  # Brief pause before restart to avoid a tight loop on a hard failure
  sleep 5
done
KIOSK
chmod +x "$KIOSK_HOME/kiosk.sh"
chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/kiosk.sh"

# ---------------------------------------------------------------------------
# 9. Cron: turn display off at 11 pm, back on at 6 am (America/Chicago)
# ---------------------------------------------------------------------------
echo "==> Scheduling display on/off (11 pm off, 6 am on)..."
# Write crontab for the kiosk user, preserving any existing entries
(crontab -u "$KIOSK_USER" -l 2>/dev/null | grep -v 'xset dpms'; \
 echo "0 23 * * * DISPLAY=:0 xset dpms force off"; \
 echo "0  6 * * * DISPLAY=:0 xset dpms force on") \
 | crontab -u "$KIOSK_USER" -

# ---------------------------------------------------------------------------
# 10. Sudoers: allow kiosk user to reboot without a password
#    (board.js does a client-side page reload at 3 am; a full reboot is
#     a nice extra for firmware/OS updates via cron)
# ---------------------------------------------------------------------------
echo "$KIOSK_USER ALL=(ALL) NOPASSWD: /sbin/reboot, /sbin/shutdown" \
  > /etc/sudoers.d/kiosk
chmod 440 /etc/sudoers.d/kiosk

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "==> Setup complete."
echo ""
echo "    Next steps:"
echo "    1. Edit ~/kiosk.sh if the URL needs changing:  nano ~/kiosk.sh"
echo "    2. Reboot:  sudo reboot"
echo "    3. After the board loads in Chromium, press Ctrl+Alt+F2 to open"
echo "       a second TTY, log in, and run:"
echo "         DISPLAY=:0 xdotool key ctrl+l"
echo "       to focus the address bar if you need to log in the first time."
echo "    4. Once you've logged in to DylanBoard, the 180-day cookie keeps"
echo "       the Pi logged in automatically."
echo ""
echo "    Display upside-down? Edit the autostart and change 'left' to 'right':"
echo "       nano ~/.config/openbox/autostart"
echo ""
