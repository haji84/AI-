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

explicit="${CODE_BUILDER_ENGINE:-}"
if [[ -n "$explicit" ]]; then
  if [[ "$explicit" == */* ]]; then
    emit_if_executable "$explicit" && exit 0
  else
    found="$(command -v "$explicit" 2>/dev/null || true)"
    emit_if_executable "$found" && exit 0
  fi
  echo "CODE_BUILDER_ENGINE_INVALID: configured engine is not executable" >&2
  exit 1
fi

for engine in codex aider; do
  found="$(command -v "$engine" 2>/dev/null || true)"
  emit_if_executable "$found" && exit 0
done

trusted_dirs=(
  "$HOME/.volta/bin"
  "$HOME/.local/bin"
  "$HOME/bin"
  "$HOME/.npm-global/bin"
  "$HOME/Library/pnpm"
  "$HOME/.asdf/shims"
)

if command -v npm >/dev/null 2>&1; then
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  [[ -z "$npm_prefix" ]] || trusted_dirs+=("$npm_prefix/bin")
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm_bin="$(pnpm bin -g 2>/dev/null || true)"
  [[ -z "$pnpm_bin" ]] || trusted_dirs+=("$pnpm_bin")
fi

if [[ -d "$HOME/.nvm/versions/node" ]]; then
  for nvm_bin in "$HOME/.nvm/versions/node"/*/bin; do
    [[ -d "$nvm_bin" ]] && trusted_dirs+=("$nvm_bin")
  done
fi

for engine in codex aider; do
  for dir in "${trusted_dirs[@]}"; do
    emit_if_executable "$dir/$engine" && exit 0
  done
done

echo "CODE_BUILDER_ENGINE_NOT_FOUND: no existing codex/aider executable found in PATH or trusted user package-manager locations" >&2
exit 1
