#!/usr/bin/env bash
set -euo pipefail

emit_if_executable() {
  local candidate="$1"
  if [[ -n "$candidate" && -f "$candidate" && -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

# The in-process Ollama adapter is not an executable on PATH.
# The authenticated worker health check proves that a local model is installed.
# Never discover Codex/Aider automatically, even when a stale executable exists.
explicit="${CODE_BUILDER_ENGINE:-}"
if [[ -n "$explicit" && "$explicit" != "goriq-ollama-repair" && "${GORIQ_ALLOW_LEGACY_CODE_BUILDER:-}" == "1" ]]; then
  if [[ "$explicit" == */* ]]; then
    emit_if_executable "$explicit" && exit 0
  else
    found="$(command -v "$explicit" 2>/dev/null || true)"
    emit_if_executable "$found" && exit 0
  fi
  echo "CODE_BUILDER_ENGINE_INVALID: explicitly authorized engine is unavailable" >&2
  exit 1
fi

printf '%s\n' "goriq-ollama-repair"
