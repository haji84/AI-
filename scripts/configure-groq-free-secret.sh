#!/bin/zsh
set -euo pipefail

REPO="${GORIQ_REPO:-haji84/AI-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required." >&2
  exit 1
fi

gh auth status >/dev/null

printf "Groq API key (hidden): "
stty -echo
IFS= read -r GROQ_KEY
stty echo
printf "\n"

cleanup() {
  unset GROQ_KEY
}
trap cleanup EXIT

if [[ -z "${GROQ_KEY:-}" ]]; then
  echo "ERROR: empty Groq API key." >&2
  exit 1
fi

printf '%s' "$GROQ_KEY" | gh secret set GROQ_API_KEY --repo "$REPO"
echo "GROQ_API_KEY stored as a GitHub Actions repository secret for $REPO."
echo "The key was not written to the repository."
