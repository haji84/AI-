#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
ENV_FILE="$STATE_ROOT/jarvis.env"
REPO_ROOT="${JARVIS_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p "$STATE_ROOT"
test -s "$ENV_FILE"
set -a
source "$ENV_FILE"
set +a
: "${JARVIS_OWNER_TOKEN:?missing JARVIS_OWNER_TOKEN}"
if [[ -z "${JARVIS_COMMANDER_KEY:-}" ]]; then
  JARVIS_COMMANDER_KEY="$(openssl rand -hex 24)"
  TMP_ENV="$(mktemp "$STATE_ROOT/jarvis.env.XXXXXX")"
  grep -v '^JARVIS_COMMANDER_KEY=' "$ENV_FILE" > "$TMP_ENV" || true
  printf 'JARVIS_COMMANDER_KEY=%s\n' "$JARVIS_COMMANDER_KEY" >> "$TMP_ENV"
  chmod 600 "$TMP_ENV"
  mv "$TMP_ENV" "$ENV_FILE"
  export JARVIS_COMMANDER_KEY
fi
export JARVIS_COMMANDER_HOST="${JARVIS_COMMANDER_HOST:-0.0.0.0}"
export JARVIS_COMMANDER_PORT="${JARVIS_COMMANDER_PORT:-8790}"

# Replace only an old JARVIS Commander listener on the dedicated port.
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -tiTCP:"$JARVIS_COMMANDER_PORT" -sTCP:LISTEN 2>/dev/null || true); do
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command_line" == *"jarvis-direct-commander"* ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  for _ in $(seq 1 20); do
    if ! lsof -tiTCP:"$JARVIS_COMMANDER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  if lsof -tiTCP:"$JARVIS_COMMANDER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $JARVIS_COMMANDER_PORT is still occupied by another process" >&2
    exit 4
  fi
fi

NODE_BIN="$(command -v node || true)"
[[ -x "$NODE_BIN" ]] || { echo "Node.js not found in LaunchAgent PATH" >&2; exit 3; }
cd "$REPO_ROOT"
exec "$NODE_BIN" scripts/jarvis-direct-commander-v3.mjs
