# Common autonomous development v0.6 specification draft

Status: DESIGN_REVIEW_REQUIRED; no runtime activation. Parent #1865.
Owner approved reference-change points1-5 in #1869 comment6400729952.
Recovered v0.5 SHA9cf979733d8d4753023b1dd239ba4a5f3be2e0a6a3216c9dda206c089a2b6aa5: static input integrity verified; model reviews UNVERIFIED0/8,0/104, semantic compatibility UNKNOWN.
Seed incomplete. Freeze archive/manifest/plan after full-scope review; derive chunks from source. Pilot8/full review/reproduction/formal approval are separate.

## Control and interfaces

One Goal authority: reuse GoalControllerRuntime, DevelopmentJob/State Controller and risk-policy via adapters. Core imports no application paths.
ProjectAdapter binds project/repo/Goal/Issue and policy. Intake.authenticate checks identity, scope, expiry and replay independently of text.
StateAdapter delegates atomic revision CAS/fencing/append-only events to State Controller; AI only requests transitions. EvidenceAdapter verifies issuer/source/artifact/run/time; stale proof is invalid.
RepositoryAdapter: complete inventory, same-Issue PR, exclusive writer/CAS; ambiguity reconciles. Persist external-write intent first; unknown outcomes RECONCILE with remote before retry, including crash after remote success.
BuilderAdapter: approved non-Codex first; evidenced exhaustion and approval precede Codex. Actions needs an actual model.
ReviewAdapter: complete coverage; trusted run metadata binds author/reviewer model/digest, isolated environment IDs and archive SHA. Self labels invalid; unknown provenance INCONCLUSIVE/HOLD. Retain bounded findings on failure; independent reproduction and legitimate GitHub approval are separate.
IntegrationAdapter atomically enforces approved head/base and current CI/review/Ruleset/Human gates at remote merge. Candidate changes invalidate proof; unenforceable means HOLD. Verify main; durably schedule successor. No new authority.

## Mandatory acceptance contracts

C01 Persist locked Goal/criteria across restart; deny unauthorized mutation.
C02 Deduplicate intake/Goal/Issue/PR; conflicting bindings reconcile.
C03 Ready tasks respect dependency DAG, priority, pause and bounded resources.
C04 AI improvement proposals cite gaps; never silently mutate approved scope.
C05 Actual independent design review precedes runtime implementation.
C06 Dynamic parallelism respects quotas, dependencies and exclusive writers.
C07 Bounded isolated Actions reject forged actors/replay/secrets/excess authority.
C08 Real same-Issue correction reuses existing remote PR; races never duplicate it.
C09 Diagnose actual CI logs; repeated strategy needs new evidence/hypothesis.
C10 Distinct actual model/environment reviews exact complete immutable source.
C11 Findings preserved, anchored, independently reproduced, fixed and re-reviewed.
C12 Human Gate and repository protections reject missing, stale or forged approval.
C13 Actual permitted integration passes all current gates; no safety bypass.
C14 Verify exact merged main artifact in real runtime; CI alone is insufficient.
C15 Unsatisfied Goal selects and durably schedules next eligible task.
C16 Crash/restart/environment loss restores Goal/jobs/evidence; stale owners rejected.
C17 Same common package integrates with two actual projects via adapters.

## Completion and boundaries

All17 need actual evidence; fixtures/plans/anchors/author PASS cannot certify E2E. Keep MACHINE_VERIFIED/HUMAN_VERIFIED/AI_ASSERTED; critical gates cannot pass on AI_ASSERTED alone.
No credentials/model-policy/billing/private-install/workflow/protection/Publisher/merge/publication grant. Independent AI09 uses its approved route only.
Spec changes require owner and independent review. Rollback preserves Goal/history, restores compatible code/config/state together and re-verifies.

## Binding contract for the implementation proposal

The following specifies required adapter behavior, not implemented APIs or activation permission. Existing types below are reuse anchors. An adapter must not infer missing authentication, atomicity, independence or authority from an existing method name. A project integration is incomplete until its concrete binding, failure behavior and real acceptance evidence are reviewed. No second Goal/State/Gate controller is introduced.

### Existing source anchors

| Existing source | Reuse and limitation |
|---|---|
| [Goal controller](../../src/orchestrator/goal-controller-runtime.ts) | `GoalControllerRuntime.handle(UnifiedIntakeRequest)` returns `GoalControllerDecision`; `GoalResolver` and `GoalRegistry` own resolution. `source`, `sourceContext`, `goalHint` and caller idempotency strings are not authenticated identity. `GoalDecisionStore.get/put` alone does not prove concurrent deduplication. |
| [Development job](../../src/orchestrator/development-job.ts) | `DevelopmentJob` binds Goal, requirements, DoD, approval scope, work items, evidence, attempts and transition history. `DevelopmentJobStateController.apply` validates a transition; it does not itself persist an atomic transaction or fence an external writer. |
| [Completion source and journal](../../src/orchestrator/completion-execution.ts) | Host-registered `CompletionSource.inspect/observe`, `CompletionJournalStore.updateCompletionExecution` and `finalizeCompletionOutcome` are the execution/journal integration points. `WorkStateStore.put` alone is insufficient for revision CAS and append-only recovery. |
| [Completion assessment](../../src/orchestrator/completion-path.ts) | `CompletionRequirement`, `CompletionCandidate`, `CompletionInput` and `CompletionCycle` bind requirements, evidence, dependencies, capabilities, failure history and recommendation. Recommendations retain `executionAuthority=false`; executing them requires the existing controller and gates. |
| [Risk policy](../../src/orchestrator/risk-policy.ts) and [release gate](../../src/orchestrator/development-release-gate.ts) | Reuse `evaluateRiskPolicy` and `evaluateDevelopmentReleaseGate`; supply verified classifications and receipts through trusted adapters. A release action or `reviewerPassed` boolean is not its own evidence. Security holds dominate ordinary release recommendations. |
| [Command ingress](../../src/orchestrator/command-ingress.ts) | `normalizeCommandEnvelope` parses existing Chat/Work/Codex inputs. Normalization is not authentication, scope verification or dispatch authorization. |

The existing controller has bounded Goal-contract inputs. Preserve its limits; represent the17 framework contracts through explicit requirement/job bindings rather than silently raising limits or dropping a requirement. Actual source/runtime limits and policy versions must accompany each binding.

### Versioned project and execution envelope

Each project supplies a reviewed `ProjectAdapter` configuration containing `contractVersion`, `projectId`, repository identity, canonical Goal authority, requirement/spec revision, adapter identities/versions, allowed capabilities, risk policy reference, approved resource/cost/data-egress limits and environment identities. Secrets are references held by the project host, never configuration payload values or shared global credentials.

Every actionable request binds project, Goal, job, task-scope ID, operation, immutable source/base/head identities, payload digest, authenticated principal/issuer, expiry, event ID and durable idempotency identity. Optional fields are explicitly versioned; unknown privileged fields or conflicting identities fail closed. A valid digest proves byte identity, not trusted origin. The host constructs trusted context independently of Chat/model text.

The adapter envelope is a proposed binding to existing types, not a replacement schema for the recovered v0.5 plan. A runtime implementation must publish its exact serializer/validator and compatibility mapping for review before installation. Missing mappings, unsupported versions or unavailable capabilities cannot fall back to a different project, Goal, model, token or environment.

### Adapter inputs, outputs and mandatory refusals

| Adapter | Required input and output | Required refusal or reconciliation |
|---|---|---|
| Project | Reviewed configuration plus host-known repository/project identity -> explicit controller/store/policy bindings. | Foreign repository/Goal, configuration drift, shared credentials or unreviewed binding -> HOLD. No application-specific import in the common core. |
| Intake | Untrusted envelope plus independently verified host context -> verified principal, permitted scope/operation, expiry, replay identity and normalized existing intake. | Forged actor/source labels, expired/revoked scope, wrong Goal, conflicting replay payload or missing proof -> no job/dispatch/write. QUESTIONS/INSPECTIONS do not create Goals. |
| State | Existing controller transition request plus expected revision, active lease/fencing generation and transition ID -> atomically committed state, append-only event and durable receipt. | Stale revision/owner, invalid transition or duplicate ID with different payload -> reject. A matching duplicate returns the original receipt. Plain get/put is not a substitute. |
| Task | Authoritative criteria/evidence, dependency DAG, candidate bindings, resources and prior strategies -> recorded existing completion assessment and eligible next task. | Cycles, unknown dependency completion, missing capacity, pause or exhausted budget -> no execution. AI proposals cannot mark dependencies complete or alter locked criteria. |
| Evidence | Host-registered issuer, immutable source/artifact/run/environment/time identities and observed result -> verified receipt linked to exact criteria. | Untrusted issuer, stale/mismatched source, missing artifact, invalid timestamp, duplicate/conflicting observation or self-attested PASS -> FAIL/INCONCLUSIVE. AI_ASSERTED stays separate. |
| Repository | Complete trusted PR inventory and current Issue/repository/head/base binding, exclusive writer and persisted intent -> same-PR CAS result or durable RECONCILE. | Multiple candidates, incomplete inventory, closed-original correction, foreign PR or stale source -> no new correction PR. Unknown remote outcomes must be reconciled before retry. |
| Builder | Approved job/scope and available host-registered non-Codex capability -> candidate diff, source identity, actual model/tool provenance and test evidence. | Missing model, unauthorised path/operation, exhausted resources or data-egress violation -> HOLD. Codex requires evidenced alternatives exhaustion and applicable existing approval; Actions is not a model. |
| Review | Complete frozen subject/coverage plan, actual maker and reviewer model/digest, independently verified environment/run provenance -> bounded raw receipts, findings and gate states. | Same actual model/environment, unsupported provenance, missing/duplicate spans, invalid response or unresolved findings -> HOLD. Role names and model self-reports do not prove independence. |
| Integration | Exact candidate and current base, verified CI/review/classifications, applicable Ruleset and scope-specific owner approvals -> permitted integration receipt, exact merged identity and post-main task. | Missing/stale/forged approval, unresolved required review, changed source/base or unenforceable required atomic condition -> HOLD. Repeated client GET checks do not prove atomic remote enforcement. |

All result objects include project/Goal/job identity, source/adapter/policy revision, receipt identity, time, outcome and evidence references. Controller-native states remain authoritative. Gate verdicts are PASS, FAIL, INCONCLUSIVE or HUMAN_REQUIRED. HOLD and RECONCILE are separate execution dispositions, not gate verdicts or native job phases: HOLD refuses execution while a gate/capability is unmet; RECONCILE requires resolving an uncertain external outcome. The reviewed binding must map verdicts/dispositions to existing controller states without treating either as PASS. Unknown values are invalid. No model result gains write, merge or completion authority.

### Scheduling, failure and recovery rules

The required adapter/controller binding must select work that removes verified Goal blockers first, retaining existing Goal Controller ownership. It must record the input/evidence digest, dependency eligibility, priority rationale, capability availability, resource budget and writer conflicts before admission. This is a target requirement, not a claim that the current intake handler implements scheduling. Dynamic parallelism is bounded by approved host capacity and exclusive resources; neither a fixed worker count nor model-suggested capacity can override those limits. Paused/security-blocked work is excluded, while unrelated authorised safe work may remain eligible.

Before any external mutation, persist an intent bound to exact project/Goal/job/operation, source identity, writer generation and expected remote state. The trusted committer must enforce its exclusive-writer/fencing contract as well as remote CAS; checking a lease once or possessing a token is insufficient. If the process dies after remote success but before the local receipt, inspect the remote object/commit and match the original intent before recording success or allowing another write. Absence, conflict and unobservable outcomes have distinct recorded recovery decisions.

CI recovery starts from actual failed-job logs and an exact source/environment failure signature. Preserve the first failure, hypothesis, strategy, attempted correction and retest. A repeated strategy needs changed evidence or a new hypothesis. Per-strategy and total execution limits survive restart; consuming a one-use grant or retry budget does not reset it. Unavailable connectivity/resources persist a resumable wait, not a successful no-op. Model output, CI success and PR creation are milestones, not Goal completion.

Restore locked Goal/criteria, jobs, evidence identities, history, leases, pending intents and next-action state through reviewed stores. Reject stale owners after resume. Reconcile external state before further mutations. Recovery acceptance includes actual environment loss and restoration to a replacement environment; a killed child process or file replay alone cannot certify it. Rollback restores dependency-consistent code/configuration/state references and re-verifies; it never erases failures or abandons the Goal.

### Independent review, approval and integration

Design review precedes runtime implementation. Review provenance must be obtained from trusted runner/model infrastructure and bind maker/reviewer model identity/digest, isolation boundary, run, subject hashes and actual responses. A renamed role, GitHub login, a second process or an author-selected PASS is insufficient. Public repositories store only permitted metadata and reviewed encrypted evidence for private subjects; keys and plaintext source/prompts/responses/findings remain private. Decrypt-and-reverify is a separate required evidence check.

Keep these gates separate: frozen-input integrity; actual8-subject pilot; actual full-source coverage; independent finding reproduction; architecture/cross-file review; formal owner/required GitHub approval; integration; post-main runtime acceptance. For original v0.5 these remain8 and104, with0 observed actual reviews at this draft revision. A successor's full count is derived from its complete bytes; it never retroactively completes the original104. A pilot is not credited twice as full review.

Preserve every bounded partial finding on INCONCLUSIVE/failed review within the approved adapter limits and retain raw evidence of truncation/failure. Verify path/line/quote against the exact subject, then separately verify impact/remedy through an authorised independent reproduction. A valid anchor is not proof of impact. Unsupported claims remain recorded with their triage outcome; they are not silently deleted to obtain PASS. Confirmed defects require a new candidate identity and exact-source re-review. The immutable original subject is not patched in place.

The human owner may be haji84 alone. Distinct actual review models/environments and required repository conditions remain separate from human identity. AI09 advisory never fabricates GitHub APPROVED. The project's applicable owner approval and real GitHub requirements must both be satisfied; this draft does not require an additional human account or change a Ruleset. HIGH/root-specification/security/secret/cost/publication/privilege changes require their existing explicit gates; CRITICAL policy weakening remains a security hold. No completion instruction expands those boundaries.

Immediately before integration, bind all required proof to the actual candidate/base and enforce the applicable conditions through the reviewed remote integration mechanism. If required race/revocation/base conditions cannot be enforced by the chosen API, retain HOLD and present the specific gap for review. A successful remote merge must return its actual merged commit/tree/artifact identity. Verify that identity on main and in the real target runtime; preserve failed post-main checks and select recovery. Only then durably assess remaining criteria and schedule the next eligible task through the same controller.

### Real acceptance observations for all17 contracts

The table defines required observations, not passing tests or authorised execution. Each row needs source/run/environment identities and machine-verifiable artifacts; fixtures remain labelled fixtures. The acceptance ledger records PASS, FAIL, INCONCLUSIVE or NOT_RUN, verifier/issuer, observation time, artifact hashes, related failures and next action. Uncertain evidence cannot produce PASS.

| ID | Positive observation required | Required negative/fault observation |
|---|---|---|
| C01 | A real locked Goal, unchanged criteria digest and progress/history survive process restart and store restoration. | An unauthorised criteria/Goal mutation is denied; missing/corrupt state does not create a replacement Goal. |
| C02 | The same authenticated event delivered concurrently and after restart resolves to one Goal/Issue/PR and the original receipt. | Reused event ID with changed payload, conflicting project/Goal or ambiguous inventory reconciles without duplicate creation. |
| C03 | Real eligible tasks respect verified dependencies and recorded priority/capacity decisions. | Cyclic/unknown dependency, pause, missing estimate/capability or exhausted budget cannot dispatch. |
| C04 | An actual AI proposal identifies a requirement gap, evidence and bounded change for review. | A proposal attempting to change approved Goal/scope/policy cannot commit that change itself. |
| C05 | Before implementation, a distinct actual model/environment reviews the complete design and its findings are triaged. | Missing/forged independence or unresolved blocking design findings prevents runtime admission. |
| C06 | Multiple real independent tasks run when capacity permits; same-resource writers serialize with durable leases/fencing. | Concurrent/stale writers, resource loss and excess requested parallelism cannot commit conflicting work. |
| C07 | An owner-authenticated ordinary Chat request reaches bounded Actions through the trusted adapter with exact Goal/event scope. | Forged/replayed actors, missing scope, secret access and excess authority are denied in the real path. |
| C08 | An actual non-Codex correction updates the existing remote Issue PR; commit/branch/Issue bindings are observed. | A competing writer or lost acknowledgement never creates another correction PR or repeats an unknown write. |
| C09 | A real CI failure is diagnosed from logs, minimally corrected and verified on the new exact HEAD. | Equivalent failed strategies without new evidence, stale CI and exhausted retries cannot be called recovered. |
| C10 | Trusted provenance and raw receipts prove distinct actual model/environment and complete immutable-source review. | Missing/duplicate/changed chunks, model identity substitution and partial receipts cannot clear review. |
| C11 | Retained findings are source-checked, independently reproduced, corrected and re-reviewed on the new candidate. | False anchors, unsupported impact, dropped partial findings and stale re-review cannot resolve a claim. |
| C12 | Actual current scope/head-bound owner approval and repository protection conditions permit only their exact operation. | Expired/revoked/forged approvals, changed source/base and absent required checks are denied without a bypass. |
| C13 | A permitted real integration records the actual merge identity after every applicable gate passes. | Missing gate or unenforceable remote condition leaves the operation on HOLD, with no integration. |
| C14 | Exact merged main artifact runs the project's real acceptance flow and yields independent observations. | A different artifact, PR-only CI, stale deployment or failing runtime cannot count as main verification. |
| C15 | After a verified cycle with an unmet Goal, the next eligible task is durably scheduled and actually starts. | Completed/blocked/duplicate/ineligible work is not rescheduled; a satisfied Goal does not launch needless work. |
| C16 | Kill/restart and actual environment loss restore authoritative state and reconcile pending external effects. | Stale owners, corrupt/incomplete checkpoints and unknown remote outcomes cannot resume writes blindly. |
| C17 | The identical common package integrates through reviewed adapters with at least two actual distinct projects. | Cross-project state/secret/permission contamination is denied; sample names and metadata replay do not count. |

### Packaging, freeze and adoption sequence

The common package contains only reviewed project-neutral contracts/controllers and adapter interfaces. Project repositories retain product source/data, policy, credentials, deployment configuration and acceptance flows. A package manifest must identify the exact shared artifact/version/digest and adapter/configuration revisions used by each real project; copying product-specific code into the core does not establish reuse. No cross-project token or default global write authority is introduced.

First settle the complete source/specification/test scope and inventory. Then produce a successor archive, per-member byte/hash manifest and ordered review plan that proves full byte coverage without missing/overlapping spans. Reject unsupported paths/types, ambiguous inventory and altered bytes. Freeze new identities only after the schema/coverage mechanism is independently reviewed; do not present a proposed successor plan as the recovered original schema. Review bounded inputs without omitting source to fit a model limit. Keep pilot/full/reproduction/formal approval and the original subject's records distinct.

The staged implementation order is: approve the reviewed specification and concrete scope; bind existing controllers/stores without activation; prove adapters and denial paths in an authorised isolated environment; prove real authenticated Chat/Builder/same-PR execution; satisfy independent review and Human Gates; perform only permitted integration and main runtime checks; prove durable continuation/environment-loss recovery; integrate the same package with two actual projects. Each stage records before/after state, exact HEAD, CI/review, unmet criteria and next action in the existing GitHub task. A failed stage is a recovery input, not a waiver of its acceptance condition.

Current status stays DESIGN_REVIEW_REQUIRED and GOAL_NOT_ACHIEVED. This detailed draft adds reviewable contracts; it does not certify their implementation, a completed successor source package, original compatibility, live Chat, independent acceptance, protected integration or runtime completion. Ownership/adoption decisions and any material deviation from existing architecture or authority remain explicit review/Human Gate items.
