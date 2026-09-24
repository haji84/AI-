# Cognitive learning audit — #1216

Baseline: main `54b5df2a41eaef75e7c40a83474aceb8fc15b3be`, 2026-09-23.
This is source/caller inspection, not new runtime, physical or model evidence.

| Capability | Existing asset | Status | Integration gap and reuse |
|---|---|---|---|
| Memory | `PersistentMemoryStore`, `GaiMemoryContextSource`, `MemoryLearningStateStore` | PARTIAL | Durable primitives exist; context/writeback composition has only test callers. Partition by tenant/principal and filter relevance. |
| World model | `PersistentWorldModel`, calibration | PARTIAL | Reuse prediction/observation/error/stats in the same loop. Avoid automatic single-success promotion by omitting its optional memory dependency. |
| Closed learning | `ClosedLearningLoop`, `VerifiedWorkLearningEngine` | PARTIAL | Evidence/held-out boundaries exist; compose with live verified cycles and explicit correction inputs. |
| Skill | `PersistentSkillLibrary`, `GovernedSkillRuntime`, `SkillExecutionRuntime` | PARTIAL | Preserve candidate/certification/regression controls. Require independent experiences and benchmark evidence before activation. |
| Correction | `TeachingCorrectionLedger`, `TeachingCorrectionLearningEngine` | PARTIAL | Explicit corrected variant plus independently verified replay exists. Generic correction import must retain this provenance, not infer truth from raw events. |
| R8 | real-local-model memory-transfer script and task families | EXPERIMENTAL | Standalone benchmark; reuse task families and ablation methodology, not old outcomes as new evidence. |
| R14 | `ContinualLearningRuntime`, continual metrics | PARTIAL | Promotion/regression contract exists; deterministic research campaign is separate from live integration. |
| R16 | `clusterFailures`, `proposeResearchHypotheses`, `decideExperiment`, persistent research history | PARTIAL | Reuse hypothesis and experiment decisions on actual Core outcomes. Existing campaign uses fixed normalization hypotheses. |
| R17 | `SelfImprovementRuntime` | PARTIAL | Preserve sandbox/test/regression/device/canary/promotion path. Adapter rollback must fail visibly if restoration fails. |
| History import | research-evidence collection | MISSING | No general provenance-bound history-to-learning importer found. Historical assertions must remain non-authoritative candidates. |
| Local adaptation | R18 preflight | SPEC_ONLY | Add privacy/dedup/split/candidate contracts. No actual training or model-quality claim. |
| Partitioning | existing stores have no user ACL | MISSING | Scope storage and recall to authenticated tenant/principal; shared knowledge requires separate sanitized promotion. |
| Independence metrics | benchmark history and transfer/attempt metrics | PARTIAL | Add external-call/local-only/unknown/skill-use/recovery counters; unavailable comparisons remain null. |

## Integration hazards

- Memory query mutates `lastUsedAt`; serialize it with writes. Both memory and skill queries include confidence even without textual relevance; do not treat their result set as applicable authority.
- World-model automatic memory promotion currently accepts a single successful observation. Core consolidation must apply a stronger independent-experience gate.
- Skill candidate replacement resets certification/outcomes; idempotent observations must not repeatedly overwrite candidates.
- Existing self-improvement runtime records rolled-back after invoking rollback without checking its result; wrap adapters to reject failed/unevidenced rollback.
- MEM-008 and TEACH requirements remain PARTIAL in the baseline requirement status. Code-only integration does not satisfy physical or real-model acceptance.
