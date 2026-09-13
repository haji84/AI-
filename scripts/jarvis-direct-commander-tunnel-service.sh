#!/usr/bin/env bash
set -euo pipefail
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
LOG="$STATE_ROOT/commander-tunnel.log"
mkdir -p "$STATE_ROOT"
: >"$LOG"
exec cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8790 >>"$LOG" 2>&1
