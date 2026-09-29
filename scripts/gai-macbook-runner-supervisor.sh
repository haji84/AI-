#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="${GAI_RUNNER_ROOT:-$HOME/actions-runner}"
STATE_ROOT="${GAI_STATE_ROOT:-$HOME/Library/Application Support/GAIWorker}"
INTERVAL="${GAI_SUPERVISOR_INTERVAL_SECONDS:-15}"
WATCHDOG="$STATE_ROOT/gai-macbook-watchdog.sh"
LOG="$STATE_ROOT/macbook-runner-supervisor.log"
mkdir -p "$STATE_ROOT"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"
}

if [[ ! "$INTERVAL" =~ ^[0-9]+$ ]] || (( INTERVAL < 5 || INTERVAL > 300 )); then
  log "Invalid supervisor interval: $INTERVAL"
  exit 2
fi

log "Supervisor started pid=$$ runnerRoot=$RUNNER_ROOT interval=${INTERVAL}s"

while true; do
  if [[ ! -f "$WATCHDOG" ]]; then
    log "Watchdog missing at $WATCHDOG"
  else
    # The watchdog already protects active Runner.Worker jobs and serializes
    # itself with a lock. The supervisor is intentionally independent of the
    # GitHub runner and only asks that watchdog to evaluate local health.
    if ! GAI_RUNNER_ROOT="$RUNNER_ROOT" /bin/bash "$WATCHDOG" >>"$LOG" 2>&1; then
      log "Watchdog iteration returned non-zero; supervisor remains alive."
    fi
  fi
  sleep "$INTERVAL"
done
