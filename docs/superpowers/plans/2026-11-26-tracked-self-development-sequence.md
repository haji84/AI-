# #1946: Real source repair through the existing Job sequence

> **For agentic workers:** Execute inline with superpowers:executing-plans and test-driven-development. The owner approved connecting the existing self-development loop in this session; routine design choices are delegated.

**Goal:** Let existing real source-repair capabilities finish one Job, survive reconstruction, and start the next preapproved Job under the same Goal.

**Architecture:** Reuse ResidentDevelopmentGoalHost/Sequence, canonical Jobs/Change Sets, tracked repair stages, frozen probes, signed receipts, authority fencing and receipt wake. Extract the existing tracked repair host options without changing their behavior. A host-pinned composition binds one existing single-Job repair manifest per sequence Job, with the complete composition digest in durable identities. A single existing Resident host selects Jobs and delegates stages; no second controller.

**Spec:** #1946, parent #921/#681, owner instruction 「OKならそこを接続して実装して」 after the agreed self-development loop. CORE-014/AUTO requirements and existing offline-self-development design remain authoritative.

**Tech:** Existing Node24 TypeScript, local Ollama/llama.cpp adapter, existing JSON/Compass authority and signed verifier contracts. No dependencies or production configuration.

## Boundaries

- Original #1219 GoalFCC/rotation37 stays NOT_ACHIEVED/G1 HOLD. No replacement or historical-source search.
- LOW, verified-local-artifact only; source scope, expiry, source/model pins, failed-candidate retention, actual checks and all Human Gates stay intact.
- New opt-in host configuration is exclusive with the existing tracked/Python/completion profiles. Existing behavior remains the default.
- No credentials, signing trust roots, permissions, schema, deployment, schedules or authority policy are provisioned. Fixture signer evidence is labeled fixture.

## Task 1: Compose existing tracked repair stages

Files: tracked-repair-resident-runtime.ts (extract options), new tracked-repair-sequence.ts (bounded pins/bindings), autonomous-tracked-repair-runtime.test.ts (existing fixture reuse).

- [x] RED/GREEN: two scoped repairs expose both existing receipt wakes, preserve the same Goal, require first receipt before second Builder, and finish only with both independently bound receipts.
- [x] Validate outer pin/Goal/scope/criteria and each leaf pin/definition. Reject shared write workspaces, receipt/request collisions with any authority and profile ambiguity before inference/state creation.
- [x] GREEN: reuse existing stage logic; do not duplicate model inference, candidate creation, recovery or acceptance code. Final full single-Job regression suite is included in required CI.

## Task 2: Connect normal host consumers

Files: jarvis-goal-executor.ts, resident-receipt-wakes.ts, approved-next-work.ts and affected tests.

- [x] Add explicit host-only sequence selection before legacy selection, including current execution-contract digest and complete candidate-workspace list for hosted admission.
- [x] Wake only declared receipts; prevent predecessor-specific configuration being reused for a new Goal. Same-Goal next Job remains controlled by the existing sequence.
- [x] Verify real subprocess reconstruction using existing executor/authority; no reinference of prepared/completed work and no bypass of canonical pause/stop/receipt checks.

## Task 3: Real small self-development acceptance

- [x] Reuse actually installed local models on a bounded real GORIQ source defect; all failed cases, exact input/response/source hashes and actual checks are retained. No autonomous-model success is claimed. Real failures led to bounded prompt deduplication, frozen-test visibility and two Codex-authored source fixes.
- [x] Separate actual model/actual checks from fixture signatures or mocked transports. Record PR/publication/physical limitations honestly.
- [x] Reconcile only existing reverse-traceability rows and new covered surfaces; preserve341 requirements, cognition, research and Creator scope.
- [ ] Run affected tests/lint/types and exact-head CI; review once, integrate only under current rules, verify main and write/read back Issue/PR/Compass history.

## Review focus / rollback

Cross-Job receipt replay; aliasing across separate leaf manifests; Goal/criterion drift; stop/lease loss at awaited stages; helper extraction changing one-Job recovery; ambiguous runtime profile silently falling back. Roll back composition/extraction/consumer hooks/related hashes together, retaining all state and failed artifacts.

## Baseline and progress

Main6b16c312, prior exact-main CI45674611626 all4SUCCESS; guard341/17/20/35 established in PR1945. Existing linked checkout reused; no user data or old branches replaced. Local models and scopes are inspected, never assumed. Compass is available but points to unrelated stopped #1845 diagnostics; preserve that state and add this task to history only. Existing PR1142/1019/1022 assets inspected: legacy orchestration/promotion/verifier work, not a current equivalent of this composition. No blanket merge.
