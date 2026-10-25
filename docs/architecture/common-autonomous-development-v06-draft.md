# Common autonomous development v0.6 specification draft

Status: DESIGN_REVIEW_REQUIRED; no runtime activation. Parent #1865.
Owner approved reference-change points1-5 in #1869 comment6400729952.
The unrecovered v0.5 SHA9cf979733d8d4753023b1dd239ba4a5f3be2e0a6a3216c9dda206c089a2b6aa5 stays UNVERIFIED0/8,0/104. Compatibility is UNKNOWN.
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
