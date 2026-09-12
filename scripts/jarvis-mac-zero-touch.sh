#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${JARVIS_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
ENV_FILE="${JARVIS_ENV_FILE:-$STATE_ROOT/jarvis.env}"
mkdir -p "$STATE_ROOT"
umask 077

random_token() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32; else python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  fi
}

read_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print; exit}' "$ENV_FILE"
}

write_env() {
  local owner="$1"
  local remote="$2"
  local serials="$3"
  local broker_url="$4"
  local remote_url="$5"
  cat >"$ENV_FILE" <<EOF
JARVIS_OWNER_TOKEN=$owner
JARVIS_REMOTE_GATEWAY_TOKEN=$remote
JARVIS_REMOTE_ALLOWED_SERIALS=$serials
JARVIS_PUBLIC_BROKER_URL=$broker_url
JARVIS_REMOTE_PUBLIC_URL=$remote_url
EOF
  chmod 600 "$ENV_FILE"
}

owner_token="$(read_env_value JARVIS_OWNER_TOKEN)"
remote_token="$(read_env_value JARVIS_REMOTE_GATEWAY_TOKEN)"
serials="$(read_env_value JARVIS_REMOTE_ALLOWED_SERIALS)"
broker_url="$(read_env_value JARVIS_PUBLIC_BROKER_URL)"
remote_url="$(read_env_value JARVIS_REMOTE_PUBLIC_URL)"
[[ -n "$owner_token" ]] || owner_token="$(random_token)"
[[ -n "$remote_token" ]] || remote_token="$(random_token)"

if command -v adb >/dev/null 2>&1; then
  detected="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}' | paste -sd, - || true)"
  [[ -z "$detected" ]] || serials="$detected"
fi
write_env "$owner_token" "$remote_token" "$serials" "$broker_url" "$remote_url"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
cd "$REPO_ROOT"

if ! command -v cloudflared >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install cloudflared >/dev/null
  else
    echo 'cloudflared missing and Homebrew unavailable' >"$STATE_ROOT/blocker.txt"
    exit 3
  fi
fi

start_bg() {
  local name="$1"
  local pattern="$2"
  local cmd="$3"
  if pgrep -f "$pattern" >/dev/null 2>&1; then return 0; fi
  nohup /bin/bash -c "$cmd" >>"$STATE_ROOT/$name.out.log" 2>>"$STATE_ROOT/$name.err.log" &
}

start_bg broker 'scripts/jarvis-broker.ts' "cd '$REPO_ROOT' && pnpm jarvis:broker"
sleep 2

start_tunnel() {
  local name="$1"
  local local_url="$2"
  local log="$STATE_ROOT/${name}-tunnel.log"
  if ! pgrep -f "cloudflared tunnel --.*url $local_url" >/dev/null 2>&1; then
    : >"$log"
    nohup cloudflared tunnel --no-autoupdate --url "$local_url" >"$log" 2>&1 &
  fi
  local deadline=$((SECONDS+25))
  local found=''
  while (( SECONDS < deadline )); do
    found="$(grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$log" 2>/dev/null | tail -1 || true)"
    [[ -n "$found" ]] && { printf '%s' "$found"; return 0; }
    sleep 1
  done
  return 1
}

new_broker_url="$(start_tunnel broker http://127.0.0.1:8787 || true)"
if [[ -n "$new_broker_url" && "$new_broker_url" != "$broker_url" ]]; then
  broker_url="$new_broker_url"
  write_env "$owner_token" "$remote_token" "$serials" "$broker_url" "$remote_url"
  pkill -f 'scripts/jarvis-broker.ts' >/dev/null 2>&1 || true
  sleep 1
  set -a; source "$ENV_FILE"; set +a
  start_bg broker 'scripts/jarvis-broker.ts' "cd '$REPO_ROOT' && pnpm jarvis:broker"
  sleep 2
fi

remote_healthy=false
if [[ -n "$serials" && -x "$(command -v adb || true)" ]]; then
  set -a; source "$ENV_FILE"; set +a
  start_bg remote-gateway 'scripts/jarvis-remote-gateway.ts' "cd '$REPO_ROOT' && pnpm jarvis:remote"
  sleep 2
  if curl -fsS --max-time 3 -H "Authorization: Bearer $remote_token" http://127.0.0.1:8790/health >/dev/null 2>&1; then
    remote_healthy=true
    new_remote_url="$(start_tunnel remote http://127.0.0.1:8790 || true)"
    if [[ -n "$new_remote_url" ]]; then remote_url="$new_remote_url"; fi
  fi
fi
write_env "$owner_token" "$remote_token" "$serials" "$broker_url" "$remote_url"

vercel_synced=false
vercel_authenticated=false
if command -v vercel >/dev/null 2>&1 && vercel whoami >/dev/null 2>&1; then
  vercel_authenticated=true
  cd "$REPO_ROOT"
  vercel link --yes --project jarvis --scope qq1130034-1738 >/dev/null 2>&1 || true
  if [[ -f .vercel/project.json ]]; then
    upsert_vercel_env() {
      local key="$1"
      local value="$2"
      [[ -n "$value" ]] || return 0
      vercel env rm "$key" production -y >/dev/null 2>&1 || true
      printf '%s' "$value" | vercel env add "$key" production >/dev/null
    }
    upsert_vercel_env JARVIS_BROKER_URL "$broker_url"
    upsert_vercel_env JARVIS_OWNER_TOKEN "$owner_token"
    if [[ "$remote_healthy" == true && -n "$remote_url" ]]; then
      upsert_vercel_env JARVIS_REMOTE_GATEWAY_URL "$remote_url"
      upsert_vercel_env JARVIS_REMOTE_GATEWAY_TOKEN "$remote_token"
    fi
    vercel --prod --yes >/dev/null
    vercel_synced=true
  fi
fi

broker_healthy=false
if curl -fsS --max-time 3 -H "Authorization: Bearer $owner_token" http://127.0.0.1:8787/api/jarvis/admin/state >/dev/null 2>&1; then broker_healthy=true; fi
cat >"$STATE_ROOT/status.json" <<JSON
{
  "brokerHealthy": $broker_healthy,
  "remoteGatewayHealthy": $remote_healthy,
  "brokerPublicUrlReady": $([[ -n "$broker_url" ]] && echo true || echo false),
  "remotePublicUrlReady": $([[ -n "$remote_url" ]] && echo true || echo false),
  "vercelAuthenticated": $vercel_authenticated,
  "vercelSynced": $vercel_synced,
  "authorizedSerialCount": $([[ -n "$serials" ]] && awk -F, '{print NF}' <<<"$serials" || echo 0),
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
cat "$STATE_ROOT/status.json"
