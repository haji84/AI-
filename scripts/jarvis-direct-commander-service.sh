#!/usr/bin/env bash
set -euo pipefail
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
  printf '\nJARVIS_COMMANDER_KEY=%q\n' "$JARVIS_COMMANDER_KEY" >> "$ENV_FILE"
  export JARVIS_COMMANDER_KEY
fi
cd "$REPO_ROOT"
exec node scripts/jarvis-direct-commander.ts
