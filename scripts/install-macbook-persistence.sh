#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="${GAI_RUNNER_ROOT:-$HOME/actions-runner}"
OLLAMA_ENDPOINT="${GAI_LOCAL_MODEL_ENDPOINT:-http://127.0.0.1:11434}"
STATE_ROOT="$HOME/Library/Application Support/GAIWorker"
AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENT_DIR/com.gai.worker-watchdog.plist"
mkdir -p "$STATE_ROOT" "$AGENT_DIR"

if [[ ! -x "$RUNNER_ROOT/run.sh" ]]; then
  echo "GitHub runner was not found at $RUNNER_ROOT" >&2
  exit 2
fi

SOURCE_WATCHDOG="$(cd "$(dirname "$0")" && pwd)/gai-macbook-watchdog.sh"
PERSISTED_WATCHDOG="$STATE_ROOT/gai-macbook-watchdog.sh"
cp "$SOURCE_WATCHDOG" "$PERSISTED_WATCHDOG"
chmod +x "$PERSISTED_WATCHDOG"

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.gai.worker-watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PERSISTED_WATCHDOG</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GAI_RUNNER_ROOT</key>
    <string>$RUNNER_ROOT</string>
    <key>GAI_LOCAL_MODEL_ENDPOINT</key>
    <string>$OLLAMA_ENDPOINT</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>StandardOutPath</key>
  <string>$STATE_ROOT/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$STATE_ROOT/launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.gai.worker-watchdog"

sleep 2
/bin/bash "$PERSISTED_WATCHDOG"

cat >"$STATE_ROOT/macbook-persistence.json" <<JSON
{
  "mode": "launch-agent-watchdog",
  "runnerRoot": "${RUNNER_ROOT//\"/\\\"}",
  "watchdog": "${PERSISTED_WATCHDOG//\"/\\\"}",
  "plist": "${PLIST//\"/\\\"}",
  "ollamaEndpoint": "${OLLAMA_ENDPOINT//\"/\\\"}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "requiresAdmin": false
}
JSON

cat "$STATE_ROOT/macbook-persistence.json"
