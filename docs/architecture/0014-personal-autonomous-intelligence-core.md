# Personal Autonomous Intelligence Core: Unified Execution Path

Status: implementation in progress

## Goal

Make Commander and other human-facing entry points thin command ingress surfaces. A natural-language request is converted into a bounded goal with a Definition of Done, evaluated under delegated authority and risk policy, then dispatched through JARVIS execution infrastructure. Execution remains subject to verification and recovery.

## Canonical path

```text
Commander / CommandChat / Mobile
  -> Intent + Goal/DoD
  -> Task Completion Authorization
  -> Risk Policy
  -> Unified Autonomy Decision
  -> JARVIS execution adapter
  -> Worker / capability
  -> Verification
  -> Recovery or Complete
```

## Rules

1. Commander is an ingress, not the source of execution policy.
2. Existing task-completion authorization is reused for bounded delegated authority.
3. CRITICAL risk is never bypassed by task-completion delegation.
4. LOW risk may proceed automatically.
5. MEDIUM risk may proceed after existing verification or valid task-completion delegation.
6. HIGH risk can only proceed when explicitly covered by the delegated task scope and is not execution-blocked; downstream policy may still require stronger controls.
7. Every execution adapter returns evidence suitable for the existing verifier/recovery loop.
8. Existing JARVIS device-task behavior must remain backward compatible while migration is incremental.

## Migration sequence

1. Introduce `unified-autonomy-path.ts` as the shared decision boundary.
2. Add tests for delegated authority and critical-risk blocking.
3. Wire Commander command ingress to create Goal/DoD and call the shared path.
4. Add a JARVIS adapter backed by the existing control plane/task queue.
5. Feed task completion/failure into the existing verifier and recovery loop.
6. Remove duplicated execution policy from Commander only after parity tests pass.
