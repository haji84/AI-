# GORIQ Cognitive Core / Primary Brain

Issue #1216; owner instruction 2026-09-23; baseline main `54b5df2a41eaef75e7c40a83474aceb8fc15b3be`.
Status: implementation candidate. This contract is not release, physical, model-quality or AGI evidence.

## Goal and ownership
GORIQ (formerly JARVIS) owns cognition. External AI supplies optional expertise. Integrate existing assets, retaining Goal Controller/WorkState/GoalDrivenLoop as authority. Cognitive State is a derived decision checkpoint, not a competing Goal registry. Existing endpoints, enrollments, credentials, device identities, queues and history stay intact.

## Required composition
Goal Manager → Context Builder → Primary Brain/Planner → Capability Router → Tool/Device Executor → independent Verifier → Learning/World Model → Recovery/Replan. Existing memory supplies working, episodic, semantic and procedural records; partitioned experience supplies strategy, failure and correction. Skill System, Research Engine, Knowledge Consolidator, Benchmark Engine and Self-Improvement Controller use the same goal/evidence identifiers.

Default preference: deterministic internal logic; applicable verified skill; memory/strategy recall; local model; bounded local experiment; local repository/data research; authorized optional external expert; genuine human assistance. Risk/Gates can override order. Capability membership and model confidence never confer authority.

## Primary Brain contract
Input includes Goal/DoD, current state, relevant scoped memory, world observations, skills, registered action capabilities, attempts/failures/evidence, constraints/risk/budget/connectivity and local-model availability. Output includes assessment, hypotheses, plan, next action, expected outcome, confidence/uncertainty, required evidence, recovery options and escalation decision.

`PrimaryBrainAdapter` exposes infer, plan, classify, summarize, hypothesize, critique and estimateConfidence. Local runtime/model selection is configurable; qwen3:4b is an initial existing-runtime candidate, not a hardcoded product dependency. Local model output is bounded untrusted data. An action proposal may only select/rebind host-approved capabilities and inputs; never accept model-written permissions or success evidence. External experts are optional adapters and require existing cost/privacy/authorization constraints. No provider SDK, credential creation or paid fallback is authorized.

Unavailable external AI does not stop safe local work. Unavailable local inference leaves a visible DEGRADED state with deterministic/skill/context work when possible. Neither empty model output nor no available action means Goal complete. Genuinely unavailable capabilities wait with persisted reasons, never manufacture results.

## Durable cognition and unknown tasks
Persist per tenant/principal/goal: hypothesis, plan/step, known/uncertain facts, assumptions, memory refs, strategy/alternatives, prediction/observation/confidence, blockers/next action, research/expert needs and learning candidates. Validate bounds, version, identity, privacy and revision before atomic writes. Concurrent/stale changes fail visibly. Resume uses existing authority and revalidates actions, never inherits permission from a checkpoint.

Unknown loop: observe → retrieve → hypothesize → decompose → predict → select safe experiment → act → observe → compare → update belief → verify → learn → replan. Bound attempts, costs, time and observations; repeated equivalent failure requires new evidence or a changed strategy. World records preserve expected/actual outcome, prediction error, possible cause, belief and lesson; inference is not a fact.

## Unified learning
Experience → evaluate → independently verify → classify → extract → generalize → candidate → benchmark → accept/reject → persist. Reuse PersistentMemoryStore, PersistentWorldModel, PersistentSkillLibrary, VerifiedWorkLearningEngine, ClosedLearningLoop, ContinualLearningRuntime and existing correction replay contracts. Construct world model without its single-success automatic generalization; explicit consolidation owns promotion.

Skills require multiple independent verified experiences, applicability/prerequisites/input schema/procedure/output/validation/failure/recovery/confidence/source IDs/counts/version. Candidate → tested → verified → active; regression quarantines/demotes. Strategy comparisons include success/completion/retry/intervention/expert/time/cost/verification/rollback/environment. Retrieve relevant failure and explicit human correction before action. Original decision, corrected decision, evidence and result survive; personal preferences do not become global rules.

Historical import accepts bounded supplied Git/issue/PR/diff/CI/workflow/spec/decision/recovery/benchmark/correction records with provenance and actual content hashes. Missing facts stay unknown; importer does not declare historic success or ingest secrets. Raw history and external suggestions stay candidates until new independent execution/verification supports promotion.

Expert records explain escalation, query, accepted/rejected suggestions, outcomes, verifier evidence and reusable lessons. Answers are not truth. Next equivalent task may use an independently verified skill without contacting the expert.

## Privacy, partitioning and local improvement
Owner, tester-private, organization, shared-generalized and global knowledge are distinct scopes. No implicit cross-user reads. Shared promotion requires sanitized evidence with authorized scope. Exclude credentials/passwords/API keys/tokens/private keys/cookies/protected personal data; secrets may appear only as opaque reference IDs. Pattern filtering is defense in depth, not a proof that arbitrary text contains no personal information.

Training pipeline: verified experience → privacy allowlist/filter → deduplication → quality filter → disjoint train/validation/held-out groups → LoRA/fine-tuning candidate → independent held-out/safety/regression → candidate model → promote/reject. Dataset creation grants no permission to train/install/promote a model. Actual resource availability, license and safety evidence remain required.

Self-improvement reuses R17: weakness → hypothesis → candidate → sandbox → benchmark → independent verification → regression/security → accept/reject → canary/promotion → rollback when needed. No weakening of Human/Security/Evidence/Privacy/Governance. Failed rollback is not restored. R8/R14/R16/R17 research campaign claims remain separately scoped.

## Independence evaluation
Measure external-AI-free and local-only completion; unknown local success; external escalation/calls per goal/dependency; skill reuse; matched memory ablation and second-attempt improvement; self recovery/human intervention/transfer. Denominator and unavailable outcomes are explicit. Zero external calls alone is not success. Synthetic contract tests must not be reported as actual-model task capability.

Acceptance A–J: known skill external-disabled; unknown experiment/replan; prior-failure avoidance; matched memory/no-memory; verified expert experience reused internally; correction nonrecurrence; offline save/restore; non-improvement rejection; regression rollback; degraded local continuation. Additionally check tenant separation, secret exclusion, replay/idempotency, held-out leakage, stale/concurrent writes, malicious model output and gate preservation.

## Rollout and rollback
Candidate source only until integration/independent review/evidence permit activation. Preserve all #883/#884/#1195/#1208 physical holds. Revert this candidate composition to existing planner if necessary; retain scoped learning/checkpoints for inspection, do not delete or migrate existing Compass/device databases. No production process, firewall, provider permissions or model changes are part of virtual verification.

## Candidate implementation boundary (2026-09-23)
The executable path is `CognitivePanel → owner-authenticated Next proxy → existing private Broker → CognitiveService → CompassGoalExecutionAdapter → CognitiveCore/GoalDrivenLoop → LocalFileCapability → independent LocalArtifactVerifier → WorkState → scoped learning`.

Material local work currently requires a host-authored bounded manifest with Goal ID, relative paths, expected hashes and DoD bindings (`GORIQ_LOCAL_WORK_MANIFEST` and `GORIQ_LOCAL_DATA_ROOT`). These are host configuration, never model/HTTP inputs. Without a manifest, the default local path can inspect context and records the missing capability. This is a current integration limitation, not completion of arbitrary unknown-task planning.

Same-host leases use OS-released native SQLite locking without creating tables or migrating an existing database. Owner metadata is synced and atomically published via a no-replace hardlink. Unknown or foreign legacy writers fail closed. Filesystem hardlink support is required; unsupported filesystems fail visibly. No shared-network-filesystem/distributed lease guarantee is claimed.

An uncertain action is not blindly repeated. Only a matching configured local artifact with independent readback can reconcile its pending WorkState binding. Other effects remain blocked for reconciliation. Authoritative WorkState commits precede cognition/learning, and incomplete child work blocks Goal completion. Learning outbox replay projects unique observations, retains certification/quarantine, and excludes held-out families before training deduplication.

For model training, historical ingestion, cross-device recovery and improvement promotion, distinguish implemented callable contracts from automated production integration; see `docs/goriq-cognitive-status.json`. Requirements remain PARTIAL until the stated remaining work and evidence are complete.
