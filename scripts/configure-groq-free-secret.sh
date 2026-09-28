#!/bin/zsh
set -euo pipefail

REPO="${GORIQ_REPO:-haji84/AI-}"
WORKFLOW="goriq-repair-engines-runtime.yml"

for command in gh node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: $command is required." >&2
    exit 1
  fi
done

gh auth status >/dev/null

printf "Groq API key (hidden): "
stty -echo
IFS= read -r GROQ_KEY
stty echo
printf "\n"

cleanup() {
  unset GROQ_KEY
  unset GROQ_API_KEY
}
trap cleanup EXIT

if [[ -z "${GROQ_KEY:-}" ]]; then
  echo "ERROR: empty Groq API key." >&2
  exit 1
fi

export GROQ_API_KEY="$GROQ_KEY"
node <<'NODE'
const key = process.env.GROQ_API_KEY || "";
const response = await fetch("https://api.groq.com/openai/v1/models", {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) {
  process.stderr.write(`ERROR: Groq API key validation failed (HTTP ${response.status}).\n`);
  process.exit(1);
}
const payload = await response.json();
const models = Array.isArray(payload?.data) ? payload.data.map((item) => item?.id).filter(Boolean) : [];
if (!models.includes("qwen/qwen3.8-27b")) {
  process.stderr.write("ERROR: Groq key is valid but qwen/qwen3.8-27b is not available to this account.\n");
  process.exit(1);
}
process.stdout.write("Groq Free Plan API key validated; qwen/qwen3.8-27b is available.\n");
NODE

printf '%s' "$GROQ_KEY" | gh secret set GROQ_API_KEY --repo "$REPO"
unset GROQ_KEY GROQ_API_KEY

echo "GROQ_API_KEY stored as a GitHub Actions repository secret for $REPO."
echo "The key was not written to the repository."

gh workflow run "$WORKFLOW" --repo "$REPO" --ref main
echo "GORIQ Repair Engines Runtime verification dispatched."
