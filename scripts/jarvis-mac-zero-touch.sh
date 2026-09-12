#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${JARVIS_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
ENV_FILE="${JARVIS_ENV_FILE:-$STATE_ROOT/jarvis.env}"
VERCEL_SYNC_FILE="$STATE_ROOT/vercel-sync.sha256"
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
  local owner="$1" remote="$2" serials="$3" broker_url="$4" remote_url="$5"
  cat >"$ENV_FILE" <<EOF
JARVIS_OWNER_TOKEN=$owner
JARVIS_REMOTE_GATEWAY_TOKEN=$remote
JARVIS_REMOTE_ALLOWED_SERIALS=$serials
JARVIS_PUBLIC_BROKER_URL=$broker_url
JARVIS_REMOTE_PUBLIC_URL=$remote_url
EOF
  chmod 600 "$ENV_FILE"
}
launch_job_exists() {
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1
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
  if command -v brew >/dev/null 2>&1; then brew install cloudflared >/dev/null; else exit 3; fi
fi

start_bg() {
  local name="$1" pattern="$2" cmd="$3"
  if pgrep -f "$pattern" >/dev/null 2>&1; then return 0; fi
  nohup /bin/bash -c "$cmd" >>"$STATE_ROOT/$name.out.log" 2>>"$STATE_ROOT/$name.err.log" &
}
if launch_job_exists com.aicompany.jarvis-broker; then
  launchctl kickstart "gui/$(id -u)/com.aicompany.jarvis-broker" >/dev/null 2>&1 || true
else
  start_bg broker 'scripts/jarvis-broker.ts' "cd '$REPO_ROOT' && pnpm jarvis:broker"
fi
sleep 2

read_tunnel_url() {
  local name="$1"
  grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$STATE_ROOT/${name}-tunnel.log" 2>/dev/null | tail -1 || true
}
start_tunnel_fallback() {
  local name="$1" local_url="$2" log="$STATE_ROOT/${name}-tunnel.log"
  if ! pgrep -f "cloudflared tunnel --.*url $local_url" >/dev/null 2>&1; then
    : >"$log"
    nohup cloudflared tunnel --no-autoupdate --url "$local_url" >"$log" 2>&1 &
  fi
}
if launch_job_exists com.aicompany.jarvis-broker-tunnel; then
  launchctl kickstart "gui/$(id -u)/com.aicompany.jarvis-broker-tunnel" >/dev/null 2>&1 || true
else
  start_tunnel_fallback broker http://127.0.0.1:8787
fi

new_broker_url=''
for _ in $(seq 1 25); do
  new_broker_url="$(read_tunnel_url broker)"
  [[ -n "$new_broker_url" ]] && break
  sleep 1
done
if [[ -n "$new_broker_url" && "$new_broker_url" != "$broker_url" ]]; then
  broker_url="$new_broker_url"
  write_env "$owner_token" "$remote_token" "$serials" "$broker_url" "$remote_url"
  if launch_job_exists com.aicompany.jarvis-broker; then
    launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-broker"
  else
    pkill -f 'scripts/jarvis-broker.ts' >/dev/null 2>&1 || true
    sleep 1
    set -a; source "$ENV_FILE"; set +a
    start_bg broker 'scripts/jarvis-broker.ts' "cd '$REPO_ROOT' && pnpm jarvis:broker"
  fi
  sleep 2
fi

remote_healthy=false
if [[ -n "$serials" && -x "$(command -v adb || true)" ]]; then
  set -a; source "$ENV_FILE"; set +a
  start_bg remote-gateway 'scripts/jarvis-remote-gateway.ts' "cd '$REPO_ROOT' && pnpm jarvis:remote"
  sleep 2
  if curl -fsS --max-time 3 -H "Authorization: Bearer $remote_token" http://127.0.0.1:8790/health >/dev/null 2>&1; then
    remote_healthy=true
    start_tunnel_fallback remote http://127.0.0.1:8790
    for _ in $(seq 1 25); do
      new_remote_url="$(read_tunnel_url remote)"
      [[ -n "$new_remote_url" ]] && { remote_url="$new_remote_url"; break; }
      sleep 1
    done
  fi
fi
write_env "$owner_token" "$remote_token" "$serials" "$broker_url" "$remote_url"

vercel_synced=false
vercel_authenticated=false
if command -v vercel >/dev/null 2>&1 && vercel whoami >/dev/null 2>&1; then
  vercel_authenticated=true
  desired_sync="$(printf '%s\n%s\n%s\n%s' "$broker_url" "$owner_token" "$remote_url" "$([[ "$remote_healthy" == true ]] && printf '%s' "$remote_token" || true)" | shasum -a 256 | awk '{print $1}')"
  previous_sync="$(cat "$VERCEL_SYNC_FILE" 2>/dev/null || true)"
  if [[ -n "$broker_url" && "$desired_sync" != "$previous_sync" ]]; then
    cd "$REPO_ROOT"
    vercel link --yes --project jarvis --scope qq1130034-1738 >/dev/null 2>&1 || true
    if [[ -f .vercel/project.json ]]; then
      upsert_vercel_env() {
        local key="$1" value="$2"
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
      printf '%s\n' "$desired_sync" >"$VERCEL_SYNC_FILE"
      vercel_synced=true
    fi
  elif [[ -n "$broker_url" && "$desired_sync" == "$previous_sync" ]]; then
    vercel_synced=true
  fi
fi

broker_healthy=false
broker_public_healthy=false
if curl -fsS --max-time 3 -H "Authorization: Bearer $owner_token" http://127.0.0.1:8787/api/jarvis/admin/state >/dev/null 2>&1; then broker_healthy=true; fi
if [[ -n "$broker_url" ]] && curl -fsS --max-time 8 -H "Authorization: Bearer $owner_token" "$broker_url/api/jarvis/admin/state" >/dev/null 2>&1; then broker_public_healthy=true; fi
cat >"$STATE_ROOT/status.json" <<JSON
{
  "brokerHealthy": $broker_healthy,
  "brokerPublicHealthy": $broker_public_healthy,
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
