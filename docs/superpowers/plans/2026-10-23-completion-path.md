# Completion path advisory implementation plan (#1858)

**Goal:** Evaluate useful next work and early human dependencies from the existing locked WorkState, without changing execution authority.

**Architecture:** A deterministic advisory function consumes WorkState, DevelopmentWorkItems, typed evidence requirements, resource observations and prior advisory cycles. It reuses Goal evaluation, risk and Recovery. The existing Compass WorkState envelope stores the advisory journal transactionally; no new database or Goal registry. Controller and DevelopmentOrchestrator expose explicit inspection methods only.

**Spec:** Owner request recorded in Issue #1858; unchanged parent #681/#1219. Main baseline f2b56c809fde6f620901001e4186d6e86d35a83d. #1817/1818 are policy-only; #1763/1764/1770 cover continuation/locking. #1831/1832 are read-only examples.

## Boundaries

- No dispatch, approval grant, canonical criterion/status/nextAction mutation, live runtime activation, workflow changes or new model/provider.
- Notification records distinguish prepared, delivered and answered. An answer is not an authorization token.
- Input is a typed trusted-adapter contract, not unrestricted natural language approval or automatic GitHub parsing.
- Execution integration requires a separate concrete Human Gate before implementation.

## Tasks

- [x] Add failing tests for contribution/dependencies, early human work, physical evidence, stagnation, duplicate work, restart and unchanged authority.
- [x] Implement `src/orchestrator/completion-path.ts`, reuse `evaluateGoalFromWorkState`, `evaluateRiskPolicy`, `evaluateRecovery`.
- [x] Add inspection methods to Goal Controller/DevelopmentOrchestrator and journal-only atomic persistence to CompassWorkStateStoreAdapter.
- [x] Add an offline Remote Lite case study and bounded synthetic comparison. No live mutation or physical-success claim.
- [ ] Run focused tests, lint/typecheck/security; obtain independent review, fix findings, open one scoped PR and inspect existing CI.

## Review focus

- Evidence invalidation, mixed revisions, latest failure vs old success, absent requirements.
- Unknown resource/risk assumptions and dependency cycles.
- Replayed cycle/receipt IDs and notification payload changes.
- Concurrent journal writes and preservation of authoritative WorkState/other envelopes.
- Bounded storage exhaustion, backward compatibility and stale Goal-contract history.

## Rollback

Revert the scoped commit, preserve journal data. No external or runtime configuration changes. Successful isolated evaluation is not full autonomous-production acceptance.
