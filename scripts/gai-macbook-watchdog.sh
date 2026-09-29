#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="${GAI_RUNNER_ROOT:-$HOME/actions-runner}"
OLLAMA_ENDPOINT="${GAI_LOCAL_MODEL_ENDPOINT:-http://127.0.0.1:11434}"
STATE_ROOT="$HOME/Library/Application Support/GAIWorker"
mkdir -p "$STATE_ROOT"
LOG_FILE="$STATE_ROOT/macbook-watchdog.log"
RUNNER_HEALTH_STATE="$STATE_ROOT/macbook-runner-health.json"
LOCK_DIR="$STATE_ROOT/macbook-watchdog.lock"
RUNNER_FAILURE_THRESHOLD="${GAI_RUNNER_FAILURE_THRESHOLD:-2}"

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

runner_connection_healthy() {
  local listeners=''
  listeners="$(pgrep -f 'Runner.Listener' 2>/dev/null || true)"
  [[ -n "$listeners" ]] || return 1

  if [[ -x /usr/sbin/lsof ]]; then
    local pid=''
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      if /usr/sbin/lsof -nP -a -p "$pid" -iTCP -sTCP:ESTABLISHED 2>/dev/null | grep -q 'TCP'; then
        return 0
      fi
    done <<<"$listeners"
  fi

  local diag_root="$RUNNER_ROOT/_diag"
  local newest_mtime=0
  local file=''
  if [[ -d "$diag_root" ]]; then
    for file in "$diag_root"/Runner_*.log; do
      [[ -f "$file" ]] || continue
      local mtime=0
      mtime="$(stat -f '%m' "$file" 2>/dev/null || printf '0')"
      if [[ "$mtime" =~ ^[0-9]+$ ]] && (( mtime > newest_mtime )); then
        newest_mtime="$mtime"
      fi
    done
  fi

  local now=0
  now="$(date +%s)"
  if (( newest_mtime > 0 && now - newest_mtime < 600 )); then
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
consecutive_runner_failures="$(get_consecutive_runner_failures)"

if [[ "$runner_protected_by_active_job" == true ]]; then
  runner_healthy=true
  if [[ "$runner_connection_ok" != true ]]; then
    log 'GitHub runner connection probe is unhealthy, but Runner.Worker is active. Skipping recycle.'
  fi
  if (( consecutive_runner_failures != 0 )); then
    set_consecutive_runner_failures 0
    consecutive_runner_failures=0
  fi
elif [[ "$runner_connection_ok" == true ]]; then
  runner_healthy=true
  if (( consecutive_runner_failures != 0 )); then
    set_consecutive_runner_failures 0
    consecutive_runner_failures=0
  fi
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
  "runnerHealthMode": "active-job-or-established-tcp-or-recent-diag",
  "activeRunnerWorkers": $active_runner_workers,
  "runnerProtectedByActiveJob": $runner_protected_by_active_job,
  "consecutiveRunnerFailures": $consecutive_runner_failures,
  "runnerRecoveryDeferred": $runner_recovery_deferred,
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
