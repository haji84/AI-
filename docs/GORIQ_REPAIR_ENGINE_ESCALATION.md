# GORIQ Repair Engine Escalation Policy

## Purpose

GORIQ must not treat Codex as its primary repair brain. Automatic repair starts with GORIQ-owned and local capabilities, then escalates outward only when earlier stages are unavailable or fail bounded verification.

## Canonical order

1. GORIQ deterministic repair
2. GORIQ learned repair / Strategy Memory replay
3. GORIQ local reasoning / local code engine
4. Another GORIQ local capability
5. Chat inside ChatGPT Project `自動化`
6. Work inside ChatGPT Project `自動化`
7. Groq Free Plan API (`qwen/qwen3.8-27b`)
8. Codex
9. HUMAN GATE

## Execution contract

- Stages are tried strictly in the order above.
- An unavailable stage is skipped. It is never reported as successful.
- A stage may produce up to the bounded local candidate budget already enforced by CI recovery.
- Every candidate must pass scope checks plus lint, tests, security regression and build before it can be committed.
- If an engine produces no usable change, violates scope, or exhausts local verification attempts, the workspace is restored to the failed PR HEAD before the next engine is tried.
- Chat and Work are not standalone repair silos. They reuse the existing `自動化` Project surfaces and their shared project context.
- If a dedicated repair Chat/Work surface is needed, it must be created from inside Project `自動化`; Project-external session creation is forbidden.
- Work is escalation-only and is not invoked for every repair.
- Stage 7 uses only the Groq Free Plan. Missing credentials, rate limits, provider failures, malformed output, or failed local verification advance to Codex.
- Codex is an external fallback/teacher engine, not the default repair engine.
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
- Stage 8: Codex.
- Stage 9: Human Gate.

External surfaces return only a bounded repair proposal/diff. GORIQ retains scope validation, verification, commit, and push authority. Chat/Work/Groq never receive GitHub push credentials.

### Project-scoped Chat/Work invariant

- Persist one reusable Project-scoped Chat URL and one reusable Project-scoped Work URL.
- Reuse them across repair attempts.
- If either surface has not been established, open Project `自動化` first and establish the surface there.
- Never silently create or use a root-level standalone Chat/Work.
- Project discovery/context failure is a stage failure, not permission to escape the Project.

### Groq Free Plan invariant

- `GROQ_API_KEY` is read only from the execution environment / GitHub Actions secret.
- Never store or echo the API key.
- No automatic billing or paid-plan transition.
- HTTP 429 or any provider/validation failure advances to stage 8.
- Groq is repair-only and is not a general planner replacement.

## Learning direction

When an external engine succeeds, GORIQ should capture the failure fingerprint, bounded diff shape, verification outcome and engine provenance so a future learned-repair stage can replay or generalize the fix before reaching external stages.
