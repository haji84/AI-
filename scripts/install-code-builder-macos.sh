#!/usr/bin/env bash
set -euo pipefail

WORKER_ID="${GAI_WORKER_ID:-macbook}"
PORT="${CODE_BUILDER_PORT:-8796}"
SOURCE_REPO="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
EXEC_TIMEOUT_MS="${CODE_BUILDER_EXEC_TIMEOUT_MS:-600000}"
ROOT="$HOME/Library/Application Support/GAIWorker/code-builder"
PLIST="$HOME/Library/LaunchAgents/com.gai.code-builder-worker.plist"
SERVICE_SOURCE="$(cd "$(dirname "$0")" && pwd)/code-builder-worker-service.ts"
SERVICE_PATH="$ROOT/code-builder-worker-service.ts"
TOKEN_PATH="$ROOT/token.txt"
STATUS_PATH="$ROOT/install-status.json"
WORKSPACE="$ROOT/workspace"
LOG_PATH="$ROOT/worker.stdout.log"
ERR_PATH="$ROOT/worker.stderr.log"

mkdir -p "$ROOT" "$HOME/Library/LaunchAgents"
cp "$SERVICE_SOURCE" "$SERVICE_PATH"

if [[ ! -d "$WORKSPACE/.git" ]]; then
  origin="$(git -C "$SOURCE_REPO" remote get-url origin)"
  [[ -n "$origin" ]] || { echo 'Code Builder source repository has no origin.' >&2; exit 3; }
  git clone --quiet "$origin" "$WORKSPACE"
else
  dirty="$(git -C "$WORKSPACE" status --porcelain)"
  if [[ -z "$dirty" ]]; then
    git -C "$WORKSPACE" fetch origin main --quiet
    git -C "$WORKSPACE" checkout main --quiet
    git -C "$WORKSPACE" reset --hard origin/main >/dev/null
  else
    echo 'Preserving in-progress isolated Builder workspace across runtime refresh.'
  fi
fi
NODE_BIN="$(command -v node)"
NODE_VERSION="$("$NODE_BIN" --version)"

if [[ ! -s "$TOKEN_PATH" ]]; then
  (openssl rand -base64 32 2>/dev/null || { uuidgen; uuidgen; }) | tr -d '\n' > "$TOKEN_PATH"
  chmod 600 "$TOKEN_PATH"
fi
TOKEN="$(cat "$TOKEN_PATH")"

ENGINE=""
for candidate in codex aider; do
  if command -v "$candidate" >/dev/null 2>&1; then
    ENGINE="$(command -v "$candidate")"
    break
  fi
done

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.gai.code-builder-worker</string>
<key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$SERVICE_PATH</string></array>
<key>WorkingDirectory</key><string>$WORKSPACE</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>EnvironmentVariables</key><dict>
<key>GAI_WORKER_ID</key><string>$WORKER_ID</string>
<key>CODE_BUILDER_HOST</key><string>127.0.0.1</string>
<key>CODE_BUILDER_PORT</key><string>$PORT</string>
<key>CODE_BUILDER_TOKEN</key><string>$TOKEN</string>
<key>CODE_BUILDER_WORKSPACE</key><string>$WORKSPACE</string>
<key>CODE_BUILDER_ENGINE</key><string>$ENGINE</string>
<key>CODE_BUILDER_EXEC_TIMEOUT_MS</key><string>$EXEC_TIMEOUT_MS</string>
</dict>
<key>StandardOutPath</key><string>$LOG_PATH</string>
<key>StandardErrorPath</key><string>$ERR_PATH</string>
</dict></plist>
PLIST
chmod 600 "$PLIST"

UID_VALUE="$(id -u)"
launchctl bootout "gui/$UID_VALUE/com.gai.code-builder-worker" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
launchctl kickstart -k "gui/$UID_VALUE/com.gai.code-builder-worker"

healthy=false
health_json='{}'
for _ in $(seq 1 40); do
  if health_json="$(curl -fsS --max-time 2 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health" 2>/dev/null)"; then
    if node -e 'const h=JSON.parse(process.argv[1]); process.exit(h.ok===true && Array.isArray(h.capabilities) && h.capabilities.includes("code-builder") ? 0 : 1)' "$health_json"; then
      healthy=true
      break
    fi
  fi
  sleep 0.5
done

active_engine="$(printf '%s' "$health_json" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const h=JSON.parse(s);process.stdout.write(String(h.engine??""))}catch{}})')"
capabilities="$(printf '%s' "$health_json" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const h=JSON.parse(s);process.stdout.write(JSON.stringify(Array.isArray(h.capabilities)?h.capabilities:[]))}catch{process.stdout.write("[]")}})')"

cat > "$STATUS_PATH" <<JSON
{
  "ok": $healthy,
  "workerId": "$WORKER_ID",
  "platform": "macos",
  "port": $PORT,
  "workspace": "$(printf '%s' "$WORKSPACE" | sed 's/"/\\\"/g')",
  "nodePath": "$(printf '%s' "$NODE_BIN" | sed 's/"/\\\"/g')",
  "nodeVersion": "$NODE_VERSION",
  "configuredEngine": "$(printf '%s' "$ENGINE" | sed 's/"/\\\"/g')",
  "activeEngine": "$(printf '%s' "$active_engine" | sed 's/"/\\\"/g')",
  "capabilities": $capabilities,
  "persistence": "launch-agent",
  "tokenStoredLocally": true,
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
chmod 600 "$STATUS_PATH"
cat "$STATUS_PATH"

[[ "$healthy" == "true" ]]
