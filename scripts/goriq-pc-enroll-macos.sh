#!/usr/bin/env bash
set -euo pipefail
set +x
ENV_FILE="${JARVIS_ENV_FILE:-$HOME/Library/Application Support/JARVIS/jarvis.env}"
test -f "$ENV_FILE"
set -a
source "$ENV_FILE"
set +a
export JARVIS_DB_PATH="${JARVIS_DB_PATH:-$HOME/.goriq/state/jarvis.db}"
exec node scripts/goriq-pc-enroll.ts
