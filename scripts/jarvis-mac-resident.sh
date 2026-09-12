#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${JARVIS_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
ENV_FILE="${JARVIS_ENV_FILE:-$STATE_ROOT/jarvis.env}"
mkdir -p "$STATE_ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat >"$ENV_FILE" <<'EOF'
# JARVIS local secrets. Keep this file private and never commit it.
JARVIS_OWNER_TOKEN=
JARVIS_REMOTE_GATEWAY_TOKEN=
JARVIS_REMOTE_ALLOWED_SERIALS=
# HTTPS URLs supplied by your authenticated tunnel/ingress when available:
JARVIS_PUBLIC_BROKER_URL=
EOF
  echo "Created $ENV_FILE. Fill the required values, then run this command again."
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${JARVIS_OWNER_TOKEN:?Set JARVIS_OWNER_TOKEN in $ENV_FILE}"
: "${JARVIS_REMOTE_GATEWAY_TOKEN:?Set JARVIS_REMOTE_GATEWAY_TOKEN in $ENV_FILE}"

cd "$REPO_ROOT"

start_service() {
  local name="$1" pattern="$2" command="$3"
  local out="$STATE_ROOT/$name.out.log" err="$STATE_ROOT/$name.err.log"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    echo "$name already running"
    return
  fi
  echo "Starting $name"
  nohup /bin/zsh -lc "$command" >>"$out" 2>>"$err" &
}

start_service "broker" "scripts/jarvis-broker.ts" "cd '$REPO_ROOT' && pnpm jarvis:broker"

if [[ -n "${JARVIS_REMOTE_ALLOWED_SERIALS:-}" ]]; then
  if command -v adb >/dev/null 2>&1; then
    start_service "remote-gateway" "scripts/jarvis-remote-gateway.ts" "cd '$REPO_ROOT' && pnpm jarvis:remote"
  else
    echo "Remote Gateway skipped: adb is not installed or not on PATH"
  fi
else
  echo "Remote Gateway waiting for JARVIS_REMOTE_ALLOWED_SERIALS"
fi

sleep 2
broker_ok=false
remote_ok=false
if curl -fsS --max-time 3 -H "Authorization: Bearer $JARVIS_OWNER_TOKEN" http://127.0.0.1:8787/api/jarvis/admin/state >/dev/null 2>&1; then broker_ok=true; fi
if [[ -n "${JARVIS_REMOTE_ALLOWED_SERIALS:-}" ]] && curl -fsS --max-time 3 -H "Authorization: Bearer $JARVIS_REMOTE_GATEWAY_TOKEN" http://127.0.0.1:8790/health >/dev/null 2>&1; then remote_ok=true; fi

cat >"$STATE_ROOT/status.json" <<JSON
{
  "brokerHealthy": $broker_ok,
  "remoteGatewayHealthy": $remote_ok,
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "envFile": "${ENV_FILE//\"/\\\"}"
}
JSON
cat "$STATE_ROOT/status.json"
