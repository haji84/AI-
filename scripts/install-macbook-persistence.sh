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
install_started_epoch="$(date +%s)"
launchctl kickstart -k "gui/$(id -u)/com.gai.worker-watchdog"

STATUS_FILE="$STATE_ROOT/macbook-watchdog-status.json"
status_fresh=false
for _ in $(seq 1 30); do
  if [[ -s "$STATUS_FILE" ]]; then
    status_mtime="$(stat -f '%m' "$STATUS_FILE" 2>/dev/null || printf '0')"
    if [[ "$status_mtime" =~ ^[0-9]+$ ]] && (( status_mtime >= install_started_epoch )); then
      status_fresh=true
      break
    fi
  fi
  sleep 1
done

if [[ "$status_fresh" != true ]]; then
  echo "Mac watchdog did not publish fresh status after launchd restart." >&2
  tail -n 80 "$STATE_ROOT/macbook-watchdog.log" 2>/dev/null || true
  tail -n 80 "$STATE_ROOT/launchd.err.log" 2>/dev/null || true
  exit 3
fi

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
