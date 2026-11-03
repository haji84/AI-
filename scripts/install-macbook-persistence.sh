#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="${GAI_RUNNER_ROOT:-$HOME/actions-runner}"
OLLAMA_ENDPOINT="${GAI_LOCAL_MODEL_ENDPOINT:-http://127.0.0.1:11434}"
STATE_ROOT="$HOME/Library/Application Support/GAIWorker"
AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENT_DIR/com.gai.worker-watchdog.plist"
SUPERVISOR_PLIST="$AGENT_DIR/com.gai.runner-supervisor.plist"
MAINTENANCE_HOLD_FILE="$STATE_ROOT/macbook-maintenance-hold.epoch"
MAINTENANCE_HOLD_SECONDS="${GAI_MAINTENANCE_HOLD_SECONDS:-180}"
mkdir -p "$STATE_ROOT" "$AGENT_DIR"

if [[ ! -x "$RUNNER_ROOT/run.sh" ]]; then
  echo "GitHub runner was not found at $RUNNER_ROOT" >&2
  exit 2
fi
if ! [[ "$MAINTENANCE_HOLD_SECONDS" =~ ^[0-9]+$ ]] || (( MAINTENANCE_HOLD_SECONDS < 30 || MAINTENANCE_HOLD_SECONDS > 900 )); then
  echo "GAI_MAINTENANCE_HOLD_SECONDS must be between 30 and 900." >&2
  exit 2
fi
maintenance_hold_until="$(( $(date +%s) + MAINTENANCE_HOLD_SECONDS ))"
printf '%s\n' "$maintenance_hold_until" > "$MAINTENANCE_HOLD_FILE"
chmod 600 "$MAINTENANCE_HOLD_FILE"

SOURCE_WATCHDOG="$(cd "$(dirname "$0")" && pwd)/gai-macbook-watchdog.sh"
PERSISTED_WATCHDOG="$STATE_ROOT/gai-macbook-watchdog.sh"
cp "$SOURCE_WATCHDOG" "$PERSISTED_WATCHDOG"
chmod +x "$PERSISTED_WATCHDOG"

SOURCE_SUPERVISOR="$(cd "$(dirname "$0")" && pwd)/gai-macbook-runner-supervisor.sh"
PERSISTED_SUPERVISOR="$STATE_ROOT/gai-macbook-runner-supervisor.sh"
cp "$SOURCE_SUPERVISOR" "$PERSISTED_SUPERVISOR"
chmod +x "$PERSISTED_SUPERVISOR"

active_runner_worker=false
if [[ "${GITHUB_ACTIONS:-}" == "true" ]] || pgrep -f 'Runner.Worker' >/dev/null 2>&1; then
  active_runner_worker=true
fi
install_started_epoch="$(date +%s)"
launchd_reconcile_deferred=false

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
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
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

if [[ "$active_runner_worker" != true ]]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl kickstart -k "gui/$(id -u)/com.gai.worker-watchdog"
else
  launchd_reconcile_deferred=true
  echo "Runner.Worker is active; updated watchdog files without restarting launchd."
fi

cat >"$SUPERVISOR_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.gai.runner-supervisor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PERSISTED_SUPERVISOR</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GAI_RUNNER_ROOT</key>
    <string>$RUNNER_ROOT</string>
    <key>GAI_LOCAL_MODEL_ENDPOINT</key>
    <string>$OLLAMA_ENDPOINT</string>
    <key>GAI_SUPERVISOR_INTERVAL_SECONDS</key>
    <string>15</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$STATE_ROOT/supervisor-launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$STATE_ROOT/supervisor-launchd.err.log</string>
</dict>
</plist>
PLIST

if [[ "$active_runner_worker" != true ]]; then
  launchctl bootout "gui/$(id -u)" "$SUPERVISOR_PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$SUPERVISOR_PLIST"
  launchctl kickstart -k "gui/$(id -u)/com.gai.runner-supervisor"
else
  launchd_reconcile_deferred=true
  echo "Runner.Worker is active; updated supervisor files without restarting launchd."
fi

STATUS_FILE="$STATE_ROOT/macbook-watchdog-status.json"
status_fresh=false
if [[ "$active_runner_worker" != true ]]; then
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
fi

cat >"$STATE_ROOT/macbook-persistence.json" <<JSON
{
  "mode": "launch-agent-watchdog",
  "runnerRoot": "${RUNNER_ROOT//\"/\\\"}",
  "watchdog": "${PERSISTED_WATCHDOG//\"/\\\"}",
  "plist": "${PLIST//\"/\\\"}",
  "supervisor": "${PERSISTED_SUPERVISOR//\"/\\\"}",
  "supervisorPlist": "${SUPERVISOR_PLIST//\"/\\\"}",
  "supervisorIntervalSeconds": 15,
  "launchdReconcileDeferred": $launchd_reconcile_deferred,
  "activeRunnerWorkerDuringInstall": $active_runner_worker,
  "maintenanceHoldUntil": $maintenance_hold_until,
  "ollamaEndpoint": "${OLLAMA_ENDPOINT//\"/\\\"}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "requiresAdmin": false
}
JSON

cat "$STATE_ROOT/macbook-persistence.json"
