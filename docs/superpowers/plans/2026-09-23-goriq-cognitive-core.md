# GORIQ Cognitive Core Implementation Plan

Goal: integrate existing GAI assets into a local-first verified Goal loop under #1216.
Spec: docs/architecture/goriq-cognitive-core.md and the owner's 28-section instruction.
Architecture: decorate existing Planner/ContextSource/StateStore and reuse GoalDrivenLoop/WorkState/CapabilityRegistry; isolated partitioned learning stores; no parallel execution authority.
Tech stack: existing TypeScript, Node 24, atomic local files, Compass adapters, existing local HTTP inference transport.

## Constraints and review focus
No credential, enrollment, permission, paid provider, database schema or governance changes. No false completion on unavailable reasoning; no untrusted action/gate/evidence promotion; no cross-tenant memory; no held-out leakage; no acknowledged rollback unless restored. Synthetic/real-local-model/physical evidence are distinct.

## Ordered phases and concrete deliverables
- [x] 0–1 Inspect main and produce source/caller gap audits. Baseline SHA above; compare research campaigns to actual production composition.
- [x] 2 Preserve full owner contract in architecture/spec and conservative requirement status.
- [ ] 3–4 cognitive-state.ts + primary-brain.ts: scoped atomic checkpoints and replaceable bounded adapter, malformed/oversized/concurrent tests.
- [ ] 5–7 cognitive-core.ts: existing GoalDrivenLoop composition; deterministic/skill/recall/local candidates; failed-action avoidance; prediction/observation; unknown bounded experiments; no-action is not success.
- [ ] 8–9 cognitive-learning.ts: existing memory/world/skill/continual contracts, verified writeback, strategy/failure/correction recall, multiple-experience candidates and applicability checks.
- [ ] 10–12 cognitive-learning-data.ts: provenance-preserving history import and privacy/dedup/group-split training candidates; external expertise stays unverified until tested.
- [ ] 13 independence measurements with explicit denominators and test A–J evidence; synthetic results labeled.
- [ ] 14 reuse SelfImprovementRuntime via independently verified candidates, reject no gain/regression and verify rollback result.
- [ ] 15 wire CompassGoalExecutionAdapter; audit command/Broker integration and restart/offline paths. Existing local code.builder still depends on configured builder; do not claim arbitrary offline coding from this adapter alone.
- [ ] 16 run related/full tests, P8 security, lint/build, requirement validation, independent review, PR/CI, record exact commit/evidence and remaining limitations.

## Parallel ownership
Brain worker: PrimaryBrain/state/Core and Compass execution seam/tests. Learning worker: learning/data adapters and tests. Lead: formal ledger, integration review, acceptance and remaining ingress wiring. At most two code workers concurrently.

## Phase gate
A test failure blocks promotion of its component and dependent phase; independent audit/docs can continue. Preserve failures and bounded repair history. Production/model/physical acceptance is not manufactured by green unit tests.
