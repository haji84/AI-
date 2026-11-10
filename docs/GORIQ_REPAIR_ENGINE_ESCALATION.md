# GORIQ Repair Engine Escalation Policy

## Purpose

GORIQ must not treat Codex as its primary repair brain. Automatic repair starts with GORIQ-owned and installed local capabilities, then uses only already-authorized optional external capabilities. Neither Codex nor CodeRabbit is a prerequisite for coding, CI, verification or goal recovery.

## Canonical order

1. GORIQ deterministic repair
2. GORIQ learned repair / Strategy Memory replay
3. GORIQ local reasoning / local code engine
4. Another GORIQ local capability
5. Chat inside ChatGPT Project `自動化`
6. Work inside ChatGPT Project `自動化`
7. Groq Free Plan API (`qwen/qwen3.8-27b`)
8. Codex (legacy opt-in only; disabled in normal unattended runs)
9. HUMAN GATE (the normal final stage when available allowed engines are exhausted)

## Execution contract

- Stages are tried strictly in the order above.
- An unavailable stage is skipped. It is never reported as successful.
- A stage may produce up to the bounded local candidate budget already enforced by CI recovery.
- Every candidate must pass scope checks plus lint, tests, security regression and build before it can be committed.
- If an engine produces no usable change, violates scope, or exhausts local verification attempts, the workspace is restored to the failed PR HEAD before the next engine is tried.
- Chat and Work are not standalone repair silos. They reuse the existing `自動化` Project surfaces and their shared project context.
- If a dedicated repair Chat/Work surface is needed, it must be created from inside Project `自動化`; Project-external session creation is forbidden.
- Work is escalation-only and is not invoked for every repair.
- Stage 5 Chat uses bounded one-minute execution phases.
- If a repair looks likely to exceed one minute before execution (large failure evidence, multiple repair paths, or structurally multi-step input), Chat is phase-split before the first send rather than waiting for a timeout.
- Planned phases remain one repair Goal: phase 1 diagnoses, phase 2 refines the exact correction, phase 3 constructs the smallest change, and phase 4 consolidates every phase result into one final bounded unified diff.
- Each completed phase is copied once, preserved as a bounded phase artifact, and explicitly reflected into the next phase prompt. Phase splitting never creates an independent task or authority scope.
- Intermediate phase output is never applied to the workspace. Only the final consolidated unified diff is returned to GORIQ for normal scope/verification checks.
- If a task was not predicted to be long but exceeds one minute, the same micro-phase path is entered at that point instead of repeating the whole task.
- If Chat shows Retry, the current Chat phase is abandoned immediately and the next smaller phase begins.
- Only a newly completed assistant response after the current phase boundary may be accepted; late output from an older phase is stale.
- After all bounded Chat phases fail, Stage 5 fails closed and canonical routing advances to Work.
- Stage 7 uses only the previously authorized Groq Free Plan. Missing credentials, quota exhaustion, provider failures or failed verification advance to the next eligible stage, normally HUMAN GATE. Never auto-select Codex from an installed CLI.
- Codex remains a historical opt-in capability only when GORIQ_ALLOW_CODEX_AUTOMATION=1 is deliberately configured. An installed CLI is not proof of quota or permission. CodeRabbit output, comments or approval are not required by this engine escalation policy; existing independent verification, GitHub protected review requirements and Human Gates remain unchanged.
- HUMAN GATE is terminal and is reached only after all available automatic stages fail or a protected action/authority is required.

## Runtime bindings

The recovery controller binds the stages directly:

- Stage 1: built-in deterministic fixers.
- Stage 2: verified patch replay from GORIQ repair memory / matching recovery history.
- Stage 3: local Ollama `qwen2.5-coder:1.5b`.
- Stage 4: local Ollama `qwen2.5-coder:3b`.
- Stage 5: existing Chat surface inside ChatGPT Project `自動化`.
- Stage 6: existing Work surface inside ChatGPT Project `自動化`.
- Stage 7: Groq Free Plan API using `qwen/qwen3.8-27b` when `GROQ_API_KEY` is configured.
- Stage 8: Disabled by default. Codex can be considered only with GORIQ_ALLOW_CODEX_AUTOMATION=1, and is never required for local operation.
- Stage 9: Human Gate when all eligible automatic capabilities are unavailable or exhausted.

External surfaces return only a bounded repair proposal/diff. GORIQ retains scope validation, verification, commit, and push authority. Chat/Work/Groq never receive GitHub push credentials.

### Project-scoped Chat/Work invariant

- Persist one reusable Project-scoped Chat URL and one reusable Project-scoped Work URL.
- Reuse them across repair attempts.
- If either surface has not been established, open Project `自動化` first and establish the surface there.
- Never silently create or use a root-level standalone Chat/Work.
- Project discovery/context failure is a stage failure, not permission to escape the Project.

### Groq Free Plan invariant

- On the ZBook, the Groq Free Plan key is configured once through the one-click `GORIQ Groq設定` launcher.
- The plaintext key is validated against Groq and then stored only as Windows CurrentUser DPAPI ciphertext under `%LOCALAPPDATA%\GORIQ\secrets\groq.dpapi`.
- Recovery decrypts the key only into the bounded Stage-7 Node child environment and clears it immediately afterward.
- GitHub CLI and a GitHub Actions repository secret are not required for Stage 7.
- Never store or echo the plaintext API key.
- No automatic billing or paid-plan transition.
- HTTP 429 or any provider/validation failure advances to the next enabled stage, normally Human Gate.
- Groq is repair-only and is not a general planner replacement.

## Learning direction

When an external engine succeeds, GORIQ should capture the failure fingerprint, bounded diff shape, verification outcome and engine provenance so a future learned-repair stage can replay or generalize the fix before reaching external stages.

### Provider-independent Builder defaults

- The ZBook/Mac persistent Builder selects the built-in `goriq-ollama-repair` adapter before any external CLI. The authenticated health endpoint advertises `code-builder` only after a bounded loopback `/api/tags` response proves an already installed supported local model.
- The local default uses only `http://127.0.0.1:11434`. No model pull, new secret, paid API or remote endpoint is performed automatically.
- Missing local model, unapproved URL, exhausted resources or missing explicit file allowlist produces a blocker. It never invokes Codex, Aider or CodeRabbit silently or fabricates successful verification.
- Legacy CLI execution, if intentionally needed later, requires a separately set `GORIQ_ALLOW_LEGACY_CODE_BUILDER=1` and an explicit `CODE_BUILDER_ENGINE`; this is not part of the default.
- Local AI-09 is an advisory reviewer. Formal signing, separate GitHub review/account requirements, six-check independent verification, immutable SHA evidence and protected Human Gates are still mandatory wherever the existing policy requires them. Do not confuse a local-model PASS with a signed independent approval.
