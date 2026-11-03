#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="${GAI_RUNNER_ROOT:-$HOME/actions-runner}"
OLLAMA_ENDPOINT="${GAI_LOCAL_MODEL_ENDPOINT:-http://127.0.0.1:11434}"
STATE_ROOT="$HOME/Library/Application Support/GAIWorker"
mkdir -p "$STATE_ROOT"
LOG_FILE="$STATE_ROOT/macbook-watchdog.log"
RUNNER_HEALTH_STATE="$STATE_ROOT/macbook-runner-health.json"
LOCK_DIR="$STATE_ROOT/macbook-watchdog.lock"
MAINTENANCE_HOLD_FILE="$STATE_ROOT/macbook-maintenance-hold.epoch"
RUNNER_FAILURE_THRESHOLD="${GAI_RUNNER_FAILURE_THRESHOLD:-2}"
RUNNER_DIAG_GRACE_SECONDS="${GAI_RUNNER_DIAG_GRACE_SECONDS:-120}"
RUNNER_SESSION_CONFLICT_GRACE_SECONDS="${GAI_RUNNER_SESSION_CONFLICT_GRACE_SECONDS:-600}"
RUNNER_SESSION_CONFLICT_STATE="$STATE_ROOT/macbook-runner-session-conflict.epoch"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" >"$LOCK_DIR/pid"
    return 0
  fi

  local old_pid=''
  old_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$old_pid" 2>/dev/null; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '%s\n' "$$" >"$LOCK_DIR/pid"
      return 0
    fi
  fi
  return 1
}

release_lock() {
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

if ! acquire_lock; then
  log 'Watchdog invocation skipped because another watchdog instance is still active.'
  exit 0
fi
trap release_lock EXIT

count_processes() {
  local pattern="$1"
  local pids=''
  pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    printf '0\n'
  else
    printf '%s\n' "$pids" | wc -l | tr -d ' '
  fi
}

get_consecutive_runner_failures() {
  if [[ ! -f "$RUNNER_HEALTH_STATE" ]]; then
    printf '0\n'
    return
  fi

  local value=''
  value="$(sed -n 's/.*"consecutiveFailures":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$RUNNER_HEALTH_STATE" | head -n 1)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
  else
    printf '0\n'
  fi
}

set_consecutive_runner_failures() {
  local count="$1"
  cat >"$RUNNER_HEALTH_STATE" <<JSON
{
  "consecutiveFailures": $count,
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}

latest_runner_log() {
  local diag_root="$RUNNER_ROOT/_diag"
  local newest_file=''
  local newest_mtime=0
  local file=''
  if [[ -d "$diag_root" ]]; then
    for file in "$diag_root"/Runner_*.log; do
      [[ -f "$file" ]] || continue
      local mtime=0
      mtime="$(stat -f '%m' "$file" 2>/dev/null || printf '0')"
      if [[ "$mtime" =~ ^[0-9]+$ ]] && (( mtime > newest_mtime )); then
        newest_mtime="$mtime"
        newest_file="$file"
      fi
    done
  fi
  [[ -n "$newest_file" ]] || return 1
  printf '%s\n' "$newest_file"
}

runner_log_has_active_session_conflict() {
  local file="$1"
  [[ -f "$file" ]] || return 1

  local tail_data=''
  tail_data="$(tail -n 220 "$file" 2>/dev/null || true)"
  local conflict_line=''
  local ready_line=''
  conflict_line="$(printf '%s\n' "$tail_data" | grep -nE 'TaskAgentSessionConflictException|A session for this runner already exists|HTTP Status:[[:space:]]*Conflict' | tail -n 1 | cut -d: -f1 || true)"
  ready_line="$(printf '%s\n' "$tail_data" | grep -nE 'Listening for Jobs|Session created' | tail -n 1 | cut -d: -f1 || true)"

  [[ "$conflict_line" =~ ^[0-9]+$ ]] || return 1
  if [[ ! "$ready_line" =~ ^[0-9]+$ ]] || (( conflict_line > ready_line )); then
    return 0
  fi
  return 1
}

runner_session_conflict_grace_active() {
  local now=0
  now="$(date +%s)"

  local since=''
  since="$(cat "$RUNNER_SESSION_CONFLICT_STATE" 2>/dev/null || true)"

  local file=''
  file="$(latest_runner_log || true)"
  local recent_conflict=false
  if [[ -n "$file" ]] && runner_log_has_active_session_conflict "$file"; then
    local conflict_log_mtime=0
    conflict_log_mtime="$(stat -f '%m' "$file" 2>/dev/null || printf '0')"
    if [[ "$conflict_log_mtime" =~ ^[0-9]+$ ]] && (( conflict_log_mtime > 0 && now - conflict_log_mtime < RUNNER_DIAG_GRACE_SECONDS )); then
      recent_conflict=true
    fi
  fi

  if [[ "$recent_conflict" == true && ! "$since" =~ ^[0-9]+$ ]]; then
    since="$now"
    printf '%s\n' "$since" >"$RUNNER_SESSION_CONFLICT_STATE"
  fi

  if [[ "$since" =~ ^[0-9]+$ ]]; then
    if (( now - since < RUNNER_SESSION_CONFLICT_GRACE_SECONDS )); then
      return 0
    fi
    # Keep the expired marker until a real healthy session clears it. This
    # prevents fresh 409 log writes from re-arming another full cooldown.
    return 1
  fi

  return 1
}

runner_connection_healthy() {
  local listeners=''
  listeners="$(pgrep -f 'Runner.Listener' 2>/dev/null || true)"
  [[ -n "$listeners" ]] || return 1

  local conflict_log=''
  conflict_log="$(latest_runner_log || true)"
  if [[ -n "$conflict_log" ]] && runner_log_has_active_session_conflict "$conflict_log"; then
    return 1
  fi

  if [[ -x /usr/sbin/lsof ]]; then
    local pid=''
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      if /usr/sbin/lsof -nP -a -p "$pid" -iTCP -sTCP:ESTABLISHED 2>/dev/null | grep -q 'TCP'; then
        return 0
      fi
    done <<<"$listeners"
  fi

  local latest_log=''
  latest_log="$(latest_runner_log || true)"
  local newest_mtime=0
  if [[ -n "$latest_log" ]]; then
    newest_mtime="$(stat -f '%m' "$latest_log" 2>/dev/null || printf '0')"
  fi

  local now=0
  now="$(date +%s)"
  if (( newest_mtime > 0 && now - newest_mtime < RUNNER_DIAG_GRACE_SECONDS )); then
    if [[ -n "$latest_log" ]] && runner_log_has_active_session_conflict "$latest_log"; then
      return 1
    fi
    return 0
  fi
  return 1
}

resolve_ollama_exe() {
  local cmd=''
  cmd="$(command -v ollama 2>/dev/null || true)"
  if [[ -n "$cmd" && -x "$cmd" ]]; then
    printf '%s\n' "$cmd"
    return 0
  fi

  local candidate=''
  for candidate in \
    "/opt/homebrew/bin/ollama" \
    "/usr/local/bin/ollama" \
    "$HOME/.local/bin/ollama" \
    "$HOME/bin/ollama"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

stop_stale_runner() {
  local active_workers=0
  active_workers="$(count_processes 'Runner.Worker')"
  if (( active_workers > 0 )); then
    log 'Runner.Worker is active; refusing to recycle the GitHub runner.'
    return 1
  fi

  local listeners=''
  listeners="$(pgrep -f 'Runner.Listener' 2>/dev/null || true)"
  if [[ -z "$listeners" ]]; then
    return 0
  fi

  local pid=''
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    log "Stopping stale Runner.Listener process pid=$pid."
    kill "$pid" 2>/dev/null || true
  done <<<"$listeners"

  sleep 2
  listeners="$(pgrep -f 'Runner.Listener' 2>/dev/null || true)"
  if [[ -n "$listeners" ]]; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      log "Force-stopping stale Runner.Listener process pid=$pid."
      kill -9 "$pid" 2>/dev/null || true
    done <<<"$listeners"
  fi
  return 0
}

start_runner() {
  if [[ ! -x "$RUNNER_ROOT/run.sh" ]]; then
    log "Runner start skipped because $RUNNER_ROOT/run.sh does not exist."
    return 1
  fi

  log 'Starting GitHub runner.'
  nohup "$RUNNER_ROOT/run.sh" >>"$STATE_ROOT/runner.out.log" 2>>"$STATE_ROOT/runner.err.log" &
  local attempt=0
  for attempt in $(seq 1 12); do
    sleep 5
    if runner_connection_healthy; then
      return 0
    fi
  done
  return 1
}

active_runner_workers="$(count_processes 'Runner.Worker')"
runner_protected_by_active_job=false
if (( active_runner_workers > 0 )); then
  runner_protected_by_active_job=true
fi

runner_connection_ok=false
if runner_connection_healthy; then
  runner_connection_ok=true
fi

runner_healthy=false
runner_recovery_deferred=false
runner_session_conflict_grace=false
if [[ "$runner_protected_by_active_job" != true && "$runner_connection_ok" != true ]] && runner_session_conflict_grace_active; then
  runner_session_conflict_grace=true
fi
consecutive_runner_failures="$(get_consecutive_runner_failures)"
maintenance_hold_active=false
maintenance_hold_until=0
if [[ -f "$MAINTENANCE_HOLD_FILE" ]]; then
  maintenance_hold_until="$(cat "$MAINTENANCE_HOLD_FILE" 2>/dev/null || printf '0')"
  now_epoch="$(date +%s)"
  if [[ "$maintenance_hold_until" =~ ^[0-9]+$ ]] && (( now_epoch < maintenance_hold_until )); then
    maintenance_hold_active=true
  else
    rm -f "$MAINTENANCE_HOLD_FILE"
    maintenance_hold_until=0
  fi
fi

if [[ "$maintenance_hold_active" == true ]]; then
  runner_healthy=true
  runner_recovery_deferred=true
  consecutive_runner_failures=0
  set_consecutive_runner_failures 0
  log "Maintenance hold active until epoch $maintenance_hold_until; skipping runner recycle."
elif [[ "$runner_protected_by_active_job" == true ]]; then
  runner_healthy=true
  rm -f "$RUNNER_SESSION_CONFLICT_STATE"
  if [[ "$runner_connection_ok" != true ]]; then
    log 'GitHub runner connection probe is unhealthy, but Runner.Worker is active. Skipping recycle.'
  fi
  if (( consecutive_runner_failures != 0 )); then
    set_consecutive_runner_failures 0
    consecutive_runner_failures=0
  fi
elif [[ "$runner_connection_ok" == true ]]; then
  runner_healthy=true
  rm -f "$RUNNER_SESSION_CONFLICT_STATE"
  if (( consecutive_runner_failures != 0 )); then
    set_consecutive_runner_failures 0
    consecutive_runner_failures=0
  fi
elif [[ "$runner_session_conflict_grace" == true ]]; then
  runner_recovery_deferred=true
  consecutive_runner_failures=0
  set_consecutive_runner_failures 0
  log "GitHub runner broker session conflict is retrying; deferring recycle for up to $RUNNER_SESSION_CONFLICT_GRACE_SECONDS seconds."
else
  consecutive_runner_failures=$((consecutive_runner_failures + 1))
  set_consecutive_runner_failures "$consecutive_runner_failures"

  if (( consecutive_runner_failures < RUNNER_FAILURE_THRESHOLD )); then
    runner_recovery_deferred=true
    log "GitHub runner connection is unhealthy ($consecutive_runner_failures/$RUNNER_FAILURE_THRESHOLD). Deferring recycle until the failure threshold is reached."
  else
    log "GitHub runner connection is unhealthy for $consecutive_runner_failures consecutive checks. Recycling idle listener."
    if stop_stale_runner; then
      sleep 2
      if start_runner; then
        runner_connection_ok=true
        runner_healthy=true
        consecutive_runner_failures=0
        set_consecutive_runner_failures 0
      fi
    else
      active_runner_workers="$(count_processes 'Runner.Worker')"
      if (( active_runner_workers > 0 )); then
        runner_protected_by_active_job=true
        runner_recovery_deferred=true
        runner_healthy=true
        consecutive_runner_failures=0
        set_consecutive_runner_failures 0
      fi
    fi
  fi
fi

ollama_healthy=false
ollama_process_present=false
if curl -fsS --max-time 5 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
  ollama_healthy=true
else
  if pgrep -f 'ollama( serve)?' >/dev/null 2>&1; then
    ollama_process_present=true
    log 'Ollama API unavailable while an Ollama process exists. Waiting before any start attempt.'
    for _ in $(seq 1 10); do
      sleep 2
      if curl -fsS --max-time 5 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
        ollama_healthy=true
        break
      fi
    done
  fi

  if [[ "$ollama_healthy" != true && "$ollama_process_present" != true ]]; then
    ollama_exe="$(resolve_ollama_exe || true)"
    if [[ -n "$ollama_exe" ]]; then
      log "Ollama API unavailable and no Ollama process exists. Starting $ollama_exe serve."
      nohup "$ollama_exe" serve >>"$STATE_ROOT/ollama.out.log" 2>>"$STATE_ROOT/ollama.err.log" &
      ollama_process_present=true
      for _ in $(seq 1 15); do
        sleep 2
        if curl -fsS --max-time 5 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
          ollama_healthy=true
          break
        fi
      done
    else
      log 'Ollama executable is not installed or discoverable in trusted local paths.'
    fi
  fi
fi

cat >"$STATE_ROOT/macbook-watchdog-status.json" <<JSON
{
  "workerId": "macbook",
  "runnerRoot": "${RUNNER_ROOT//\"/\\\"}",
  "runnerHealthy": $runner_healthy,
  "runnerConnectionHealthy": $runner_connection_ok,
  "runnerSessionConflictGrace": $runner_session_conflict_grace,
  "runnerSessionConflictGraceSeconds": $RUNNER_SESSION_CONFLICT_GRACE_SECONDS,
  "runnerHealthMode": "active-job-or-established-tcp-or-recent-diag-or-session-conflict-grace",
  "activeRunnerWorkers": $active_runner_workers,
  "runnerProtectedByActiveJob": $runner_protected_by_active_job,
  "consecutiveRunnerFailures": $consecutive_runner_failures,
  "runnerRecoveryDeferred": $runner_recovery_deferred,
  "maintenanceHoldActive": $maintenance_hold_active,
  "maintenanceHoldUntil": $maintenance_hold_until,
  "ollamaEndpoint": "${OLLAMA_ENDPOINT//\"/\\\"}",
  "ollamaHealthy": $ollama_healthy,
  "ollamaProcessPresent": $ollama_process_present,
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

if [[ "$runner_healthy" != true && "$runner_recovery_deferred" == true ]]; then
  log 'WARNING: GitHub runner health check failed; recovery is deferred to avoid reacting to a transient failure.'
fi
if [[ "$runner_healthy" != true && "$runner_recovery_deferred" != true ]]; then
  log 'WARNING: GitHub runner is still unavailable after recovery attempt.'
fi
if [[ "$ollama_healthy" != true ]]; then
  log 'WARNING: Ollama is still unavailable after recovery attempt.'
fi

if [[ "$runner_healthy" != true && "$runner_recovery_deferred" != true ]]; then
  exit 2
fi
