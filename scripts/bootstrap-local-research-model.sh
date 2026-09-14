#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${GAI_LOCAL_MODEL_ENDPOINT:-http://127.0.0.1:11434}"
MODEL="${GAI_LOCAL_MODEL_NAME:-qwen2.5:1.5b}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if ! command -v ollama >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    log "Installing Ollama with Homebrew."
    brew install ollama
  else
    echo "OLLAMA_INSTALLER_UNAVAILABLE: Homebrew is not installed." >&2
    exit 2
  fi
fi

if ! curl -fsS --max-time 5 "$ENDPOINT/api/tags" >/dev/null 2>&1; then
  log "Starting ollama serve."
  nohup ollama serve >"${TMPDIR:-/tmp}/gai-ollama.out.log" 2>"${TMPDIR:-/tmp}/gai-ollama.err.log" &
  for _ in $(seq 1 30); do
    sleep 2
    if curl -fsS --max-time 5 "$ENDPOINT/api/tags" >/dev/null 2>&1; then break; fi
  done
fi

if ! curl -fsS --max-time 5 "$ENDPOINT/api/tags" >/dev/null 2>&1; then
  echo "OLLAMA_ENDPOINT_UNAVAILABLE: $ENDPOINT" >&2
  exit 3
fi

if ! curl -fsS "$ENDPOINT/api/tags" | grep -Fq "\"name\":\"$MODEL\""; then
  log "Pulling $MODEL for local research smoke tests."
  ollama pull "$MODEL"
fi

log "Local research model ready: $MODEL"
