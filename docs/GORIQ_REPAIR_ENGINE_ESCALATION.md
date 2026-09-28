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
7. Another free external engine
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

## Adapter status

The recovery controller provides executable adapter slots for:

- GORIQ learned repair: `GORIQ_LEARNED_REPAIR_COMMAND`
- GORIQ local code: `GORIQ_LOCAL_CODE_REPAIR_COMMAND`
- GORIQ local capability: `GORIQ_LOCAL_CAPABILITY_REPAIR_COMMAND`
- Chat: `GORIQ_CHAT_REPAIR_COMMAND`
- Work: `GORIQ_WORK_REPAIR_COMMAND`
- Free external engine: `GORIQ_FREE_EXTERNAL_REPAIR_COMMAND`

GORIQ deterministic repair is built in. Codex remains auto-discovered as the stage-8 fallback.

An adapter command receives the bounded repair prompt on stdin and may edit only the checked-out recovery workspace. GitHub write credentials are stripped from its environment. The recovery controller, not the adapter, retains commit/push authority.

## Learning direction

When an external engine succeeds, GORIQ should capture the failure fingerprint, bounded diff shape, verification outcome and engine provenance so a future learned-repair stage can replay or generalize the fix before reaching external stages.
