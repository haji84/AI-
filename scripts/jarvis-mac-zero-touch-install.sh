#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${JARVIS_INSTALL_ROOT:-$HOME/JARVIS-AI-}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
LAUNCH_ROOT="$HOME/Library/LaunchAgents"
RECONCILER_PLIST="$LAUNCH_ROOT/com.aicompany.jarvis-zero-touch.plist"
BROKER_PLIST="$LAUNCH_ROOT/com.aicompany.jarvis-broker.plist"
TUNNEL_PLIST="$LAUNCH_ROOT/com.aicompany.jarvis-broker-tunnel.plist"
ADB_ENROLL_PLIST="$LAUNCH_ROOT/com.aicompany.jarvis-adb-enrollment.plist"
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$STATE_ROOT" "$LAUNCH_ROOT" "$LOCAL_BIN"

if [[ ! -d "$INSTALL_ROOT/.git" ]]; then
  git clone https://github.com/haji84/AI-.git "$INSTALL_ROOT"
fi
cd "$INSTALL_ROOT"
git fetch origin main
git checkout main
git reset --hard origin/main

if ! command -v brew >/dev/null 2>&1; then
  echo 'JARVIS requires Homebrew on this Mac to provision Node 24, cloudflared, and ADB.' >&2
  exit 4
fi
if ! brew list --versions node@24 >/dev/null 2>&1; then brew install node@24 >/dev/null; fi
if ! brew list --versions cloudflared >/dev/null 2>&1; then brew install cloudflared >/dev/null; fi
if ! command -v adb >/dev/null 2>&1; then brew install --cask android-platform-tools >/dev/null; fi
NODE24_BIN="$(brew --prefix node@24)/bin"
export PATH="$NODE24_BIN:$LOCAL_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "24" ]]; then
  echo "Expected Node 24 but resolved $(node --version) at $(command -v node)" >&2
  exit 5
fi
if ! command -v pnpm >/dev/null 2>&1; then npm install -g --prefix "$HOME/.local" pnpm@11.19.0 >/dev/null; fi
if ! command -v vercel >/dev/null 2>&1; then npm install -g --prefix "$HOME/.local" vercel >/dev/null; fi
node --version
pnpm --version
adb version | head -1
pnpm install --frozen-lockfile >/dev/null

RUNTIME_PATH="$NODE24_BIN:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cat >"$RECONCILER_PLIST" <<PLIST
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
<key>EnvironmentVariables</key><dict><key>PATH</key><string>$RUNTIME_PATH</string></dict>
</dict></plist>
PLIST

# Run the reconciler once first so it creates the private local env/tokens.
launchctl bootout "gui/$(id -u)" "$RECONCILER_PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$RECONCILER_PLIST"
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-zero-touch"
for _ in $(seq 1 20); do
  [[ -s "$STATE_ROOT/jarvis.env" ]] && break
  sleep 1
done
[[ -s "$STATE_ROOT/jarvis.env" ]] || { echo 'JARVIS reconciler did not create jarvis.env' >&2; exit 6; }

cat >"$BROKER_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.aicompany.jarvis-broker</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$INSTALL_ROOT/scripts/jarvis-mac-broker-service.sh</string></array>
<key>WorkingDirectory</key><string>$INSTALL_ROOT</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>$STATE_ROOT/broker-service.out.log</string>
<key>StandardErrorPath</key><string>$STATE_ROOT/broker-service.err.log</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>$RUNTIME_PATH</string></dict>
</dict></plist>
PLIST

cat >"$TUNNEL_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.aicompany.jarvis-broker-tunnel</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$INSTALL_ROOT/scripts/jarvis-mac-broker-tunnel-service.sh</string></array>
<key>WorkingDirectory</key><string>$INSTALL_ROOT</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>$STATE_ROOT/broker-tunnel-service.out.log</string>
<key>StandardErrorPath</key><string>$STATE_ROOT/broker-tunnel-service.err.log</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>$RUNTIME_PATH</string></dict>
</dict></plist>
PLIST

cat >"$ADB_ENROLL_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.aicompany.jarvis-adb-enrollment</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$INSTALL_ROOT/scripts/jarvis-adb-mass-enroll.sh</string></array>
<key>WorkingDirectory</key><string>$INSTALL_ROOT</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>5</integer>
<key>ThrottleInterval</key><integer>3</integer>
<key>StandardOutPath</key><string>$STATE_ROOT/adb-enrollment.out.log</string>
<key>StandardErrorPath</key><string>$STATE_ROOT/adb-enrollment.err.log</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>$RUNTIME_PATH</string>
<key>JARVIS_ADB_MASS_ENABLE_TCP</key><string>1</string>
<key>JARVIS_ADB_MAX_NODES</key><string>100</string>
</dict>
</dict></plist>
PLIST

# Remove any legacy background children. launchd will now own these processes.
pkill -f 'scripts/jarvis-broker.ts' >/dev/null 2>&1 || true
pkill -f 'cloudflared tunnel.*127.0.0.1:8787' >/dev/null 2>&1 || true
for plist in "$BROKER_PLIST" "$TUNNEL_PLIST" "$ADB_ENROLL_PLIST"; do launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true; done
launchctl bootstrap "gui/$(id -u)" "$BROKER_PLIST"
launchctl bootstrap "gui/$(id -u)" "$TUNNEL_PLIST"
launchctl bootstrap "gui/$(id -u)" "$ADB_ENROLL_PLIST"
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-broker"
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-broker-tunnel"
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-adb-enrollment"

# Reconcile the new tunnel URL and current service health.
rm -f "$STATE_ROOT/status.json"
sleep 6
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-zero-touch"
for _ in $(seq 1 45); do
  if [[ -s "$STATE_ROOT/status.json" ]]; then cat "$STATE_ROOT/status.json"; exit 0; fi
  sleep 2
done
echo 'JARVIS did not produce fresh status after launchd-owned service bootstrap.' >&2
exit 7
