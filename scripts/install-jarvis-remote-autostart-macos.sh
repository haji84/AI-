#!/bin/zsh
set -euo pipefail

ROOT="${1:-$(pwd)}"
LABEL="ai.jarvis.remote-host"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_VALUE="$(id -u)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required" >&2
  exit 2
fi
if [ ! -f "$ROOT/package.json" ]; then
  echo "Repository root not found: $ROOT" >&2
  exit 2
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd '$ROOT' &amp;&amp; exec pnpm jarvis:remote:host</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/jarvis-remote-host.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/jarvis-remote-host-error.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID_VALUE" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
launchctl enable "gui/$UID_VALUE/$LABEL"
launchctl kickstart -k "gui/$UID_VALUE/$LABEL"

echo "Installed $LABEL"
echo "Logs: $HOME/Library/Logs/jarvis-remote-host.log"
