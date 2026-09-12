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
export JARVIS_WORKER_APK_PATH="${JARVIS_WORKER_APK_PATH:-$STATE_ROOT/jarvis-worker.apk}"
export JARVIS_QRENCODE_PATH="${JARVIS_QRENCODE_PATH:-$(command -v qrencode || true)}"
cd "$REPO_ROOT"
exec pnpm jarvis:broker
