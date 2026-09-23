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


## Continuation 2026-09-24: material/outcome compilation
Baseline candidate `596b3f893ddfcc0ea5d5989a55e29e7f1265cc70` passed CI1853; component stage evidence is in `docs/goriq-cognitive-status.json`. This next increment keeps #1216 and PR #1217; no Production mutation.

Minimum change: a host-authorized material/outcome contract compiles prerequisite reads and output actions through existing GoalDrivenLoop/WorkState. Reuse LocalFileCapability, LocalSpreadsheetCapability, LocalDocumentCapability and independent LocalArtifactVerifier. Fixed conversions: text copy, validated workbook JSON to XLSX, validated document JSON to DOCX. Owner specifies material hash, output path/domain and criterion bindings, not per-step procedure or expected generated artifact hash. HTTP callers and models cannot supply scope/verification authority.

Verification: RED runtime integration test first (outcome configuration ignored); compiler unit/security cases; full Core restart/outcome test; actual authenticated Broker and CLI host configuration; independent review; repository tests/P8/lint/build/CI and evidence. Reject source changes, occupied outputs, malformed/oversized/private data, unsupported transforms and conflicting legacy/new configuration. Prior step manifests remain compatible.

This is bounded task compilation, not arbitrary novel planning, truth validation of supplied claims, model fine-tuning or physical acceptance. Remaining work stays in the canonical requirement ledger.

## Continuation 2026-09-24: authenticated material intake and historical learning
Ruling: use existing owner-authenticated private Broker for direct bounded material upload instead of external Blob acquisition. Existing Blob references lack trusted local/Goal binding; local-first execution must not require external storage. This preserves the same Goal authority and avoids adding secrets, cloud dependencies or caller paths. Static host contracts remain compatible. Host opt-in remains inactive in Production.

Tasks: (1) TDD immutable owner material intake with generated paths/hash and full Goal digest, shared execution lease, explicit existing criteria; (2) integrate service/Broker/proxy/Tasks UI and authenticated verified output retrieval; (3) real host historical manifest import into durable unverified candidate store and existing dataset rejection pipeline; (4) unit/security/Broker/browser/full tests, independent review, CI and conservative evidence write-back. Raw content never grants policy or becomes verified knowledge. Natural-language Goal interpretation and physical acceptance remain separate requirements until actually implemented/proven.
