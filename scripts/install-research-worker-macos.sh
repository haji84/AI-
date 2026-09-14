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
  <key>Label</key><string>com.gai.research-worker</string>
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
launchctl bootout "gui/$UID_VALUE/com.gai.research-worker" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
launchctl kickstart -k "gui/$UID_VALUE/com.gai.research-worker"

healthy=false
for _ in $(seq 1 30); do
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
