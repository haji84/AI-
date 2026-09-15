#!/bin/zsh
set -euo pipefail

if [[ "${1:-}" != "--apply" ]]; then
  echo "Usage: sudo $0 --apply [repo-root]" >&2
  echo "This explicitly installs a system LaunchDaemon and enables macOS autorestart after AC power loss." >&2
  exit 2
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "Run explicitly with sudo. This script will not self-elevate." >&2
  exit 2
fi

ROOT="${2:-$(pwd)}"
OWNER_USER="${SUDO_USER:-}"
if [[ -z "$OWNER_USER" || "$OWNER_USER" == "root" ]]; then
  echo "SUDO_USER must identify the normal JARVIS owner account." >&2
  exit 2
fi

OWNER_UID="$(id -u "$OWNER_USER")"
OWNER_HOME="$(dscl . -read "/Users/$OWNER_USER" NFSHomeDirectory | awk '{print $2}')"
PNPM_PATH="$(sudo -u "$OWNER_USER" /bin/zsh -lc 'command -v pnpm')"
LABEL="ai.jarvis.remote-host"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
LOG_DIR="$OWNER_HOME/Library/Logs"

if [[ ! -f "$ROOT/package.json" ]]; then
  echo "Repository root not found: $ROOT" >&2
  exit 2
fi
if [[ -z "$PNPM_PATH" || ! -x "$PNPM_PATH" ]]; then
  echo "pnpm is not available for $OWNER_USER" >&2
  exit 2
fi
if [[ ! -f "$ROOT/.next/BUILD_ID" ]]; then
  echo "Production build missing. Run pnpm install --frozen-lockfile && pnpm build first." >&2
  exit 2
fi

mkdir -p "$LOG_DIR"
chown "$OWNER_USER":staff "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>UserName</key><string>$OWNER_USER</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd '$ROOT' &amp;&amp; exec '$PNPM_PATH' jarvis:remote:host</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/jarvis-remote-host.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/jarvis-remote-host-error.log</string>
</dict>
</plist>
EOF

chown root:wheel "$PLIST"
chmod 644 "$PLIST"
/usr/bin/pmset -a autorestart 1
/bin/launchctl bootout system "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap system "$PLIST"
/bin/launchctl enable "system/$LABEL"
/bin/launchctl kickstart -k "system/$LABEL"

echo "Installed system LaunchDaemon: $PLIST"
echo "Enabled macOS autorestart after AC power restoration."
echo "JARVIS runs as user $OWNER_USER (uid=$OWNER_UID), not as root."
echo "Verify with: pnpm jarvis:power:check"
