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
CAPABILITY_EVIDENCE="$STATE_ROOT/runtime-capabilities.json"
BUILDER_TOKEN="$HOME/Library/Application Support/GAIWorker/code-builder/token.txt"
builder_ready=false; [[ -s "$BUILDER_TOKEN" ]] && builder_ready=true
release_ready=false; [[ -n "${GORIQ_SELF_DEVELOPMENT_RELEASE_URL:-}" && -n "${GORIQ_SELF_DEVELOPMENT_RELEASE_TOKEN:-}" ]] && release_ready=true
cat >"$CAPABILITY_EVIDENCE" <<JSON
{
  "builderReady": $builder_ready,
  "releaseReady": $release_ready,
  "developmentRuntimeExplicit": $([[ "${GORIQ_SELF_DEVELOPMENT_RUNTIME:-}" == "1" ]] && echo true || echo false),
  "goalContextPersistence": true,
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
chmod 600 "$CAPABILITY_EVIDENCE"
cat "$CAPABILITY_EVIDENCE"
cd "$REPO_ROOT"
exec pnpm jarvis:broker
