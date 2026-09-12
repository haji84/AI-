#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${JARVIS_INSTALL_ROOT:-$HOME/JARVIS-AI-}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
PLIST="$HOME/Library/LaunchAgents/com.aicompany.jarvis-zero-touch.plist"
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$STATE_ROOT" "$HOME/Library/LaunchAgents" "$LOCAL_BIN"

if [[ ! -d "$INSTALL_ROOT/.git" ]]; then
  git clone https://github.com/haji84/AI-.git "$INSTALL_ROOT"
fi
cd "$INSTALL_ROOT"
git fetch origin main
git checkout main
git reset --hard origin/main

export PATH="$LOCAL_BIN:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    npm install -g --prefix "$HOME/.local" pnpm@11.19.0 >/dev/null
  elif command -v brew >/dev/null 2>&1; then
    brew install pnpm >/dev/null
  else
    echo 'pnpm bootstrap failed: npm and Homebrew are unavailable' >&2
    exit 4
  fi
fi
pnpm --version
pnpm install --frozen-lockfile >/dev/null

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.aicompany.jarvis-zero-touch</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>$INSTALL_ROOT/scripts/jarvis-mac-zero-touch.sh</string></array>
<key>WorkingDirectory</key><string>$INSTALL_ROOT</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>60</integer>
<key>StandardOutPath</key><string>$STATE_ROOT/zero-touch-launch.out.log</string>
<key>StandardErrorPath</key><string>$STATE_ROOT/zero-touch-launch.err.log</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict></plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-zero-touch"
sleep 5
cat "$STATE_ROOT/status.json" 2>/dev/null || true
