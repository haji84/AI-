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

Material local work accepts either the existing per-step contract (`GORIQ_LOCAL_WORK_MANIFEST`) or the additive desired-outcome contract (`GORIQ_LOCAL_OUTCOMES`), each paired with `GORIQ_LOCAL_DATA_ROOT`. The latter declares source material IDs/paths/hashes/formats and output IDs/paths/domains/Goal criteria. The compiler derives prerequisite observations and output actions; the owner does not supply steps, dependency ordering or generated artifact hashes. Supported fixed transformations are text copy, scalar workbook JSON to XLSX and document JSON to DOCX. Reuse LocalFileCapability, LocalSpreadsheetCapability, LocalDocumentCapability and independent LocalArtifactVerifier lineage. This verifies faithful conversion of supplied material, not the factual truth of its claims. Formula evaluation and arbitrary novel transforms are unsupported.

Example host outcome contract (replace the Goal ID and source hash with actual values):
```json
{"version":1,"goalId":"goal-0123456789abcdef","materials":[{"id":"numbers","path":"numbers.json","sha256":"<actual source SHA-256>","format":"workbook-json"}],"outcomes":[{"id":"workbook","materialId":"numbers","path":"result.xlsx","domain":"spreadsheet","criteria":["criterion-1"]}]}
```
The material uses the existing workbook contract: `{"cells":[{"sheet":"Result","cell":"A1","value":42}]}`. Document material uses `{"title":"Report","sections":{"Result":"Supplied text"}}`. These are host configuration and data, never model/HTTP authority. Calls still accept only the existing Goal ID; no arbitrary path, tool, verifier or environment grant is accepted. With no local execution mode configured, local execution can inspect context. The additive owner material intake below supplies a bounded direct-input path; general conversational attachment retrieval and natural-language-to-authorized-task synthesis remain software gaps.

Limits: 24 materials, 24 outputs and 32 combined actions, 64KiB source/config, 1MiB generated artifact, 1,024 scalar cells/16 sheets or 32 document sections. Reject secrets, formulas, XML-forbidden noncharacters, Office CR/CRLF or sheet-name attribute whitespace unsupported by the reused codecs, unsupported/extra fields, path escapes, symlinks, source drift, oversized occupied outputs and conflicting writes. Budget exhaustion or unsupported input is visible, never a successful empty result.

Before completion or pending-action reconciliation, bind the complete host contract and canonical data root to the Goal checkpoint. Changed/missing contracts and unbound prior material/WorkState evidence fail closed; do not adopt old PASS. Existing checkpoint JSON remains readable because this additive field is optional. Prior candidate material history without a binding needs explicit review, not automatic migration or erasure. A Goal contract change is rejected before any recovery authority write. All declared outputs must have current-contract verified action evidence, even when several satisfy the same Goal criterion. Old per-step contracts require their declared steps too. Status also rejects stale completion after contract drift.

Same-host leases use OS-released native SQLite locking without creating tables or migrating an existing database. Owner metadata is synced and atomically published via a no-replace hardlink. Unknown or foreign legacy writers fail closed. Filesystem hardlink support is required; unsupported filesystems fail visibly. No shared-network-filesystem/distributed lease guarantee is claimed.

An uncertain action is not blindly repeated. Only a matching configured local artifact with independent readback can reconcile its pending WorkState binding. Other effects remain blocked for reconciliation. Authoritative WorkState commits precede cognition/learning, and incomplete child work blocks Goal completion. Learning outbox replay projects unique observations, retains certification/quarantine, and excludes held-out families before training deduplication.

For model training, historical ingestion, cross-device recovery and improvement promotion, distinguish implemented callable contracts from automated production integration; see `docs/goriq-cognitive-status.json`. Requirements remain PARTIAL until the stated remaining work and evidence are complete.

## Owner material intake, historical candidates and correction controls (2026-09-24)

The candidate Task UI now connects an explicit owner action to the existing execution spine:

`CognitiveMaterials → owner-authenticated Next proxy → private Broker → CognitiveService.prepareMaterials → immutable material receipt → outcome compiler → GoalDrivenLoop/WorkState → independent artifact verification → verified download`.

This mode is opt-in host configuration: `GORIQ_LOCAL_MATERIAL_INTAKE=1` with an existing isolated `GORIQ_LOCAL_DATA_ROOT`. It is mutually exclusive with the legacy step manifest and host outcome manifest; both older modes remain supported. The candidate does not set Production configuration or add filesystem permission. Without the host opt-in, no new material control appears. Old Broker status responses retain the current Goal controls and show that learning controls are unavailable.

The owner selects bounded UTF-8 text/Markdown/CSV or canonical workbook/document JSON directly in the browser and maps each desired output to existing Goal criteria. The browser sends content and format in the authenticated request body; no remote URL, Blob claim, local path, root, source hash, partition, tool permission or verification status is accepted. Selection is not automatic file harvesting. The acknowledgement means that faithful material conversion satisfies the selected criteria; it does not verify the material's factual claims or interpret arbitrary semantic outcomes. Raw Excel, Word and PDF parsing is not implemented by this path.

The service rereads the authoritative Goal under the same execution lease, checks its digest and generates source/output paths, hashes and a receipt bound to Goal, tenant/principal, canonical data root, complete manifest and request digest. A new binding cannot adopt prior material work, pending actions, learning outbox, child work or prior verification. Source files and the receipt are published without replacing existing content. An exact retry reuses the same receipt and checks staged bytes; changed input, Goal, root or source fails closed. Restart loads the receipt through the existing runtime catalog resolver; the continue API remains `goalId` only.

Intake bounds: 8 materials, 64KiB per source, 128KiB aggregate source bytes and a 300,000-byte request body. Existing workbook/document schema and artifact limits still apply. The UI requires nonempty current Goal criteria and an explicit mapping. Free-text-created Goals currently may have no criteria; ordinary conversational DoD extraction and trusted semantic binding remain unfinished. An unmapped criterion prevents Goal completion. Download requires current-contract verified action IDs, fresh source/output lineage verification and an exact check of the downloaded bytes against deterministic source encoding. Responses use generated filenames, bounded bytes, attachment disposition, no-store and nosniff. State-root, source, staging and artifact symlinks are rejected in the tested same-host paths; this is not a distributed or hostile concurrent-filesystem isolation guarantee.

`CognitiveLearning` adds explicit history import, training-candidate counts and correction selection. `GORIQ_HISTORY_MANIFEST` plus the existing data root enables a host-owned manifest:

```json
{"version":1,"sources":[{"id":"decision-v1","path":"prior-decision.md","kind":"decision","familyId":"output-validation","classification":"internal","scope":"owner"}]}
```

The importer reads only listed local artifacts, derives their source hashes and canonical-root provenance, and stores immutable partitioned candidates. It reuses the existing historical importer and training dataset builder. Manifest limits are 32KiB/24 descriptors; source limits are 8KiB each/128KiB per batch; the store allows 500 records/5MiB. Paths, UTF-8, byte bounds, privacy screening, record identity and schema are checked before a batch commit. Reads of status never import source material. Restart/retry and concurrent processes preserve existing records; a changed version needs a new source ID. Supplied verification/hash/content/partition fields are rejected.

Every imported historical claim stays `UNVERIFIED`, even when its document claims a CI or review PASS. UI/API responses expose counts, not raw source content or filesystem paths. Dataset preview merges verified live experiences with the stored candidates and excludes unverified history while preserving held-out families. It does not train, promote a model, turn logs into memory, or make historical prose execution authority. Live GitHub harvesting, independent historical claim revalidation and promotion remain unfinished. Pattern-based privacy screening is defense in depth, not proof that arbitrary data is anonymous.

Corrections select actual current-Goal attempt IDs and require a distinct independently verified successful replacement in the same environment. The service holds the execution lease, checks Goal/contract identity and rejects pending action/outbox reconciliation before recording the correction. Replay is idempotent. The existing learning engine applies the correction to future relevant recall and quarantines incompatible skills. Free-form corrections and a trusted Goal/catalog binding for physical teaching variants remain unfinished.

R16 already receives runtime failure-derived research hypotheses; an actual experiment runner is still missing. R17 retains its independent/security/regression/rollback adapter contract; autonomous model/code promotion and hardware training are not activated. Generic novel task decomposition, executable Skill synthesis, cross-device transport, physical recovery and broad actual-model independence evaluation also remain open. The current increment is PARTIAL until those requirements and their evidence are fulfilled.

The isolated browser acceptance script `scripts/goriq-cognitive-browser-smoke.mjs` exercises actual owner login, direct material upload and acknowledgement, Core execution, exact verified download, learning-candidate feedback, repeated refresh, reload persistence and expanded learning controls at a 390px viewport. It uses an already installed browser, a temporary local Broker/Compass database and no owner browser profile; evidence must record the tested commit and result. UI sibling keys are distinct for material/learning controls and their responsive fieldsets preserve mobile containment. This bounded browser flow is not physical device, unrestricted semantic-task or production acceptance.
