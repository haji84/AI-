#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="${JARVIS_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
ENV_FILE="${JARVIS_ENV_FILE:-$STATE_ROOT/jarvis.env}"
[[ -s "$ENV_FILE" ]] || { echo "Missing runtime env: $ENV_FILE" >&2; exit 2; }
set -a
source "$ENV_FILE"
set +a
: "${JARVIS_OWNER_TOKEN:?Set JARVIS_OWNER_TOKEN in $ENV_FILE}"
NODE24_BIN="/opt/homebrew/opt/node@24/bin"
export PATH="$NODE24_BIN:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO_ROOT"
exec pnpm jarvis:broker
