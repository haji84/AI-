#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="${GAI_RUNNER_ROOT:-$HOME/actions-runner}"
OLLAMA_ENDPOINT="${GAI_LOCAL_MODEL_ENDPOINT:-http://127.0.0.1:11434}"
STATE_ROOT="$HOME/Library/Application Support/GAIWorker"
mkdir -p "$STATE_ROOT"
LOG_FILE="$STATE_ROOT/macbook-watchdog.log"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

runner_healthy=false
if pgrep -f 'Runner.Listener' >/dev/null 2>&1; then
  runner_healthy=true
elif [[ -x "$RUNNER_ROOT/run.sh" ]]; then
  log 'Runner.Listener not found. Starting GitHub runner.'
  nohup "$RUNNER_ROOT/run.sh" >>"$STATE_ROOT/runner.out.log" 2>>"$STATE_ROOT/runner.err.log" &
  sleep 3
  if pgrep -f 'Runner.Listener' >/dev/null 2>&1; then runner_healthy=true; fi
else
  log "Runner start skipped because $RUNNER_ROOT/run.sh does not exist."
fi

ollama_healthy=false
if curl -fsS --max-time 5 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
  ollama_healthy=true
elif command -v ollama >/dev/null 2>&1; then
  log 'Ollama API unavailable. Starting ollama serve.'
  nohup ollama serve >>"$STATE_ROOT/ollama.out.log" 2>>"$STATE_ROOT/ollama.err.log" &
  for _ in $(seq 1 15); do
    sleep 2
    if curl -fsS --max-time 5 "$OLLAMA_ENDPOINT/api/tags" >/dev/null 2>&1; then
      ollama_healthy=true
      break
    fi
  done
else
  log 'Ollama executable is not installed yet.'
fi

cat >"$STATE_ROOT/macbook-watchdog-status.json" <<JSON
{
  "workerId": "macbook",
  "runnerRoot": "${RUNNER_ROOT//\"/\\\"}",
  "runnerHealthy": $runner_healthy,
  "ollamaEndpoint": "${OLLAMA_ENDPOINT//\"/\\\"}",
  "ollamaHealthy": $ollama_healthy,
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

$runner_healthy || log 'WARNING: GitHub runner is still unavailable after recovery attempt.'
$ollama_healthy || log 'WARNING: Ollama is still unavailable after recovery attempt.'
