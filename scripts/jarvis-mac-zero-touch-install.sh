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

if ! command -v brew >/dev/null 2>&1; then
  echo 'JARVIS requires Homebrew on this Mac to provision Node 24 and cloudflared.' >&2
  exit 4
fi

if ! brew list --versions node@24 >/dev/null 2>&1; then
  brew install node@24 >/dev/null
fi
NODE24_BIN="$(brew --prefix node@24)/bin"
export PATH="$NODE24_BIN:$LOCAL_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "24" ]]; then
  echo "Expected Node 24 but resolved $(node --version) at $(command -v node)" >&2
  exit 5
fi

if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g --prefix "$HOME/.local" pnpm@11.19.0 >/dev/null
fi
if ! command -v vercel >/dev/null 2>&1; then
  npm install -g --prefix "$HOME/.local" vercel >/dev/null
fi
node --version
pnpm --version
pnpm install --frozen-lockfile >/dev/null

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.aicompany.jarvis-zero-touch</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$INSTALL_ROOT/scripts/jarvis-mac-zero-touch.sh</string></array>
<key>WorkingDirectory</key><string>$INSTALL_ROOT</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>60</integer>
<key>StandardOutPath</key><string>$STATE_ROOT/zero-touch-launch.out.log</string>
<key>StandardErrorPath</key><string>$STATE_ROOT/zero-touch-launch.err.log</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE24_BIN:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict></plist>
PLIST

# Never let the workflow mistake a previous run's status for the current bootstrap.
rm -f "$STATE_ROOT/status.json"
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-zero-touch"
sleep 5
cat "$STATE_ROOT/status.json" 2>/dev/null || true
