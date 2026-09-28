# GORIQ Repair Engine Escalation Policy

## Purpose

GORIQ must not treat Codex as its primary repair brain. Automatic repair starts with GORIQ-owned and local capabilities, then escalates outward only when earlier stages are unavailable or fail bounded verification.

## Canonical order

1. GORIQ deterministic repair
2. GORIQ learned repair / Strategy Memory replay
3. GORIQ local reasoning / local code engine
4. Another GORIQ local capability
5. Chat
6. Work
7. Groq Free Plan API
8. Codex
9. HUMAN GATE

## Execution contract

- Stages are tried strictly in the order above.
- An unavailable stage is skipped. It is never reported as successful.
- A stage may produce up to the bounded local candidate budget already enforced by CI recovery.
- Every candidate must pass scope checks plus lint, tests, security regression and build before it can be committed.
- If an engine produces no usable change, violates scope, or exhausts local verification attempts, the workspace is restored to the failed PR HEAD before the next engine is tried.
- Codex is an external fallback/teacher engine, not the default repair engine.
- HUMAN GATE is terminal and is reached only after all available automatic stages fail or a protected action/authority is required.

## 自動化 project Chat / Work contract

Stages 5 and 6 reuse one canonical AI Company conversation instead of creating disposable conversations.

- Canonical project: `自動化`
- Canonical title: `自動化 GORIQ Repair`
- Chat and Work append owner messages to the same conversation.
- The conversation keeps the existing `ai-chat-conversation:v1` project, memory, pending/synced and comment formats.
- If the canonical conversation does not exist, it is created once with `project="自動化"`; later repairs reuse it.
- A live pending request fails closed as busy rather than creating an uncontrolled parallel conversation.
- A stale pending request older than the bounded stale threshold can be reconciled before reuse.
- Chat uses the existing ChatGPT bridge path.
- Work uses the same project conversation and escalates the requested repair surface to Work.
- Repair output is still treated only as a candidate diff. GORIQ retains verification, commit and push authority.

## Stage 2 / local stages

- Stage 2 persists verified patches by Failure Fingerprint in local GORIQ repair memory and replays matching bounded patches before invoking a model.
- Stage 3 uses local Ollama `qwen2.5-coder:1.5b`.
- Stage 4 uses local Ollama `qwen2.5-coder:3b`.
- Local model output may edit only AllowedPaths and must pass the same verification gates.

## Stage 7: Groq Free Plan

- Provider: Groq API.
- Secret name: `GROQ_API_KEY`.
- The key is stored only as a GitHub Actions repository secret, never in source, Issue text, logs or prompts.
- Missing key means stage 7 is unavailable and the router proceeds to stage 8.
- Rate-limit or provider failures fail closed and proceed to the next engine.
- The Groq adapter receives only bounded repair evidence and AllowedPaths content.
- Groq output cannot commit, push or merge.

## Stage 8: Codex

Codex remains auto-discovered only as the final automatic coding fallback before HUMAN GATE.

## Learning direction

When Chat, Work, Groq or Codex succeeds, GORIQ stores the verified failure fingerprint and bounded patch provenance so later equivalent failures can be solved by Stage 2 before reaching an external engine.
