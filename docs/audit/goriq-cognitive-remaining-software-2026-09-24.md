# #1216 remaining software after portable learning and R16 calibration

Independent read-only review on2026-09-24. Current PR1217 remains draft; OWN-001 PARTIAL. CI and synthetic fixtures do not establish full product/AGI acceptance.

## First implementation

**Host-fixed independent evaluation-trial collection.** Normal Core observations are train; no pre-execution heldout allocation exists (`src/gai/cognitive-core.ts`, `cognitive-learning.ts`, `cognitive-research.ts`). Persist an immutable evaluation plan/Goal/material hash/criteria before execution, reuse current local capabilities and independent verifier, and store only its actual measurements as heldout. No retrospective relabeling. Test split/evidence overlap, changed contracts, restart and metric-to-artifact agreement. Do not touch existing registered fleet or reinterpret old history.

## Subsequent integration

1. **Measured Skill certification:** existing `CognitiveLearningEngine.certify()` accepts host-supplied scores; bind it to actual immutable baseline/candidate evaluation receipts. Equal results must remain candidates. COG-007.
2. **Unknown-task plan compiler:** current PrimaryBrainAdapter selects supplied IDs and local materials use fixed transforms. Compose a bounded set of existing operations with input/dependency/output/DoD contracts and independent oracles. Do not execute unconstrained model scripts. COG-003.
3. **Teaching-to-Core binding:** reuse TeachingCorrectionLearningEngine; bind verified variant/run evidence to exact Goal/partition/current action contract. Avoid constructing live TeachingStore just to inspect: it rewrites interrupted runs. COG-009 / teaching-runtime.ts.
4. **Historical revalidation/shared knowledge:** imported artifacts remain UNVERIFIED. Extract recheckable claims, reproduce evidence and promote provenance-bound candidates; independently redact owner/tester private data for generalized sharing. COG-010/013 / cognitive-history.ts.
5. **R17 actual candidate adapters:** dataset is CANDIDATE_ONLY and improvement runtime accepts supplied adapters. Connect one bounded reversible improvement class to real sandbox/regression/rollback; model training/code change are not yet automatic. COG-012/016 / cognitive-learning-data.ts / cognitive-learning.ts.
6. **Cross-host recovery contract:** local restart works, but transfer, single-writer handoff and destination capability checks remain. Simulate two hosts before real device/network/power acceptance. COG-014 / cognitive-state.ts.
7. **Actual local-model campaign:** reuse existing twelve independence metrics across heldout task families, memory ablations, correction recurrence and transfer. Current bounded qwen smoke and synthetic calibration are not broad quality evidence. GPU/training environment needs assessment before LoRA. External experts remain optional and cannot block local execution. COG-011/012/015.

## Dependencies and non-claims

These are software gaps as well as model/physical acceptance gaps. User presence is not required for the bounded software work. Existing-device migration, real power/network/cross-device tests and broad model capability cannot be marked PASS from CI. No new paid provider, secrets, permission, production or device enrollment changes are authorized by this audit.
