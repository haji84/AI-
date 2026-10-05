#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$#" == 5 && "$(uname -s)" == Darwin && "$(id -u)" != 0 ]] || exit 70
readonly _goriqNode="$1" _goriqRelease="$2" _goriqRevision="$3" _goriqDb="$4" _goriqHome="$5"
[[ "$_goriqRevision" =~ ^[a-f0-9]{40}$ && -x "$_goriqNode" && -s "$_goriqDb" ]] || exit 70
readonly _goriqEnv="$_goriqHome/Library/Application Support/JARVIS/jarvis.env"
[[ -s "$_goriqEnv" && ! -L "$_goriqEnv" && "$(stat -f '%u' "$_goriqEnv")" == "$(id -u)" ]] || exit 70
set -a
source "$_goriqEnv" >/dev/null
set +a
[[ -n "${JARVIS_OWNER_TOKEN:-}" && ( -n "${JARVIS_OWNER_SECRET:-}" || -n "${AI_COMPANY_OWNER_SECRET:-}" ) ]] || exit 70
[[ -z "${JARVIS_DB_PATH:-}" || "$JARVIS_DB_PATH" == "$_goriqDb" ]] || exit 70
export JARVIS_DB_PATH="$_goriqDb"
export JARVIS_COMPASS_DB_PATH="${JARVIS_COMPASS_DB_PATH:-${GORIQ_STATE_ROOT:-$_goriqHome/.goriq/state}/compass.db}"
[[ -s "$JARVIS_COMPASS_DB_PATH" ]] || exit 70
export JARVIS_WORKER_APK_PATH="${JARVIS_WORKER_APK_PATH:-$_goriqHome/Library/Application Support/JARVIS/jarvis-worker.apk}"
export JARVIS_BROKER_URL="http://127.0.0.1:8787" JARVIS_REMOTE_GATEWAY_URL="http://127.0.0.1:8790"
export GORIQ_RUNTIME_REVISION="$_goriqRevision" JARVIS_PRIVATE_WORKER_INGRESS_ENABLED=1
export JARVIS_BROKER_HOST=127.0.0.1 JARVIS_REMOTE_GATEWAY_HOST=127.0.0.1 JARVIS_DASHBOARD_PORT=3000
export PATH="$(dirname "$_goriqNode"):$_goriqHome/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
unset VERCEL NODE_OPTIONS
cd "$_goriqRelease"
exec "$_goriqNode" node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
