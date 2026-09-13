#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
LOG="$STATE_ROOT/commander-tunnel.log"
mkdir -p "$STATE_ROOT"
: >"$LOG"
CLOUDFLARED_BIN="$(command -v cloudflared || true)"
[[ -x "$CLOUDFLARED_BIN" ]] || { echo "cloudflared not found in LaunchAgent PATH" >&2; exit 3; }
exec "$CLOUDFLARED_BIN" tunnel --no-autoupdate --url http://127.0.0.1:8790 >>"$LOG" 2>&1
