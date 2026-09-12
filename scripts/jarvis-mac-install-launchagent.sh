#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${JARVIS_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
PLIST="$HOME/Library/LaunchAgents/com.aicompany.jarvis-runtime.plist"
mkdir -p "$STATE_ROOT" "$HOME/Library/LaunchAgents"

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.aicompany.jarvis-runtime</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>$REPO_ROOT/scripts/jarvis-mac-resident.sh</string></array>
<key>WorkingDirectory</key><string>$REPO_ROOT</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>$STATE_ROOT/launchagent.out.log</string>
<key>StandardErrorPath</key><string>$STATE_ROOT/launchagent.err.log</string>
</dict></plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-runtime"
echo "Installed JARVIS resident runtime: $PLIST"
