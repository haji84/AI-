#!/usr/bin/env bash
set -euo pipefail

WORKER_ID="${GAI_WORKER_ID:-macbook}"
PORT="${RESEARCH_WORKER_PORT:-8795}"
MODEL_ENDPOINT="${GAI_LOCAL_MODEL_ENDPOINT:-http://127.0.0.1:11434}"
MODEL_NAME="${GAI_LOCAL_MODEL_NAME:-qwen2.5:1.5b}"
ROOT="$HOME/Library/Application Support/GAIWorker/research-worker"
PLIST="$HOME/Library/LaunchAgents/com.gai.research-worker.plist"
SERVICE_SOURCE="$(cd "$(dirname "$0")" && pwd)/research-worker-service.ts"
SERVICE_PATH="$ROOT/research-worker-service.ts"
TOKEN_PATH="$ROOT/token.txt"
STATUS_PATH="$ROOT/install-status.json"
LOG_PATH="$ROOT/worker.log"
ERR_PATH="$ROOT/worker.err.log"
LABEL="com.gai.research-worker"

mkdir -p "$ROOT" "$HOME/Library/LaunchAgents"
cp "$SERVICE_SOURCE" "$SERVICE_PATH"
NODE_BIN="$(command -v node)"
if [[ ! -s "$TOKEN_PATH" ]]; then
  (openssl rand -base64 32 2>/dev/null || { uuidgen; uuidgen; }) | tr -d '\n' > "$TOKEN_PATH"
  chmod 600 "$TOKEN_PATH"
fi
TOKEN="$(cat "$TOKEN_PATH")"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$SERVICE_PATH</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GAI_WORKER_ID</key><string>$WORKER_ID</string>
    <key>GAI_LOCAL_MODEL_ENDPOINT</key><string>$MODEL_ENDPOINT</string>
    <key>GAI_LOCAL_MODEL_NAME</key><string>$MODEL_NAME</string>
    <key>RESEARCH_WORKER_HOST</key><string>127.0.0.1</string>
    <key>RESEARCH_WORKER_PORT</key><string>$PORT</string>
    <key>RESEARCH_WORKER_TOKEN</key><string>$TOKEN</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_PATH</string>
  <key>StandardErrorPath</key><string>$ERR_PATH</string>
</dict>
</plist>
PLIST
chmod 600 "$PLIST"

UID_VALUE="$(id -u)"
DOMAIN="gui/$UID_VALUE"
SERVICE="$DOMAIN/$LABEL"

# Reinstall idempotently. launchd can briefly keep the old service registered
# after bootout; retry bootstrap instead of treating that transient as fatal.
launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
  if ! launchctl print "$SERVICE" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

bootstrapped=false
for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "$DOMAIN" "$PLIST" >/tmp/gai-research-worker-bootstrap.out 2>/tmp/gai-research-worker-bootstrap.err; then
    bootstrapped=true
    break
  fi
  # If launchd reports the service as present despite bootstrap returning an
  # error, continue if it can be restarted and the health check succeeds.
  if launchctl print "$SERVICE" >/dev/null 2>&1; then
    bootstrapped=true
    break
  fi
  sleep "$attempt"
done

if [[ "$bootstrapped" != "true" ]]; then
  echo "launchctl bootstrap failed" >&2
  cat /tmp/gai-research-worker-bootstrap.err >&2 || true
  exit 5
fi

launchctl kickstart -k "$SERVICE" >/dev/null 2>&1 || true

healthy=false
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/tmp/gai-research-worker-health.json 2>/dev/null; then
    healthy=true
    break
  fi
  sleep 0.5
done

cat > "$STATUS_PATH" <<JSON
{
  "ok": $healthy,
  "workerId": "$WORKER_ID",
  "platform": "macos",
  "port": $PORT,
  "modelEndpoint": "$MODEL_ENDPOINT",
  "model": "$MODEL_NAME",
  "persistence": "launch-agent",
  "root": "$ROOT",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
cat "$STATUS_PATH"
[[ "$healthy" == "true" ]]
