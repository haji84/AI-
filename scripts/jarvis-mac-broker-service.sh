#!/usr/bin/env bash
set -euo pipefail
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
ENV_FILE="${JARVIS_ENV_FILE:-$STATE_ROOT/jarvis.env}"
REPO_ROOT="${JARVIS_REPO_ROOT:-$HOME/JARVIS-AI-}"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 2; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
cd "$REPO_ROOT"
exec pnpm jarvis:broker
