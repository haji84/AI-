# Common autonomous development v0.6 specification draft

Status: DESIGN_REVIEW_REQUIRED; no runtime activation. Parent #1865.
Owner approved reference-change points1-5 in #1869 comment6400729952.
The unrecovered v0.5 SHA9cf979733d8d4753023b1dd239ba4a5f3be2e0a6a3216c9dda206c089a2b6aa5 stays UNVERIFIED0/8,0/104. Compatibility is UNKNOWN.
The11-file seed is incomplete. Freeze a new archive/manifest/plan only after full scope is reviewed; derive total chunks from actual source. Pilot8 then full review, reproduction and formal approval are distinct gates.

## Control and interfaces

One Goal authority. Reuse GoalControllerRuntime, DevelopmentJob/State Controller and risk-policy via a GORIQ adapter; portable core imports no application paths.
ProjectAdapter binds project/repo/Goal/Issue and policy. Intake.authenticate checks identity, scope, expiry and replay independently of text.
StateAdapter.load/commit uses controller-owned atomic revision CAS, fencing and append-only events; AI cannot commit transitions directly. EvidenceAdapter verifies issuer/source/artifact/run/time and invalidates stale proof.
RepositoryAdapter rechecks complete inventory before same-Issue PR repair, using exclusive writer/CAS. Ambiguity reconciles.
BuilderAdapter: approved non-Codex first; evidenced exhaustion and approval precede Codex. Actions needs an actual model.
ReviewAdapter binds complete source coverage and actual distinct model/environment identity. Preserve bounded findings on failure; retain INCONCLUSIVE/HOLD. Independent behavioral verification and legitimate GitHub approval remain separate.
IntegrationAdapter rechecks head/base, CI, reviews, Rulesets and Human Gate immediately before merge, verifies main and schedules successors. No new authority.

## Mandatory acceptance contracts

C01 Locked Goal/criteria survive a fresh process; unauthorized mutation denied.
C02 Duplicate intake/Goal/Issue/PR is idempotent; conflicting bindings reconcile.
C03 Ready tasks respect dependency DAG, priority, pause and bounded resources.
C04 AI improvement proposals cite gaps; never silently mutate approved scope.
C05 Actual independent design review precedes runtime implementation.
C06 Dynamic parallelism respects quotas, dependencies and exclusive writers.
C07 Bounded isolated Actions reject forged actors, replay, secrets and excess authority.
C08 Real same-Issue correction reuses existing remote PR; races never duplicate it.
C09 Real CI logs drive diagnosis; repeat strategy requires new evidence/hypothesis.
C10 Distinct actual model/environment reviews exact complete immutable source.
C11 Findings preserved, anchored, independently reproduced, fixed and re-reviewed.
C12 Human Gate and repository protections reject missing, stale or forged approval.
C13 Actual permitted integration passes all current gates; no safety bypass.
C14 Main runtime acceptance matches exact merged artifact; CI alone is insufficient.
C15 Unsatisfied Goal selects and durably schedules next eligible task.
C16 Crash/restart/environment loss restores Goal/jobs/evidence; stale owners rejected.
C17 Same common package integrates with two actual projects via adapters.

## Completion and boundaries

All17 need actual evidence; fixtures/plans/anchors/author PASS cannot certify E2E. Keep MACHINE_VERIFIED/HUMAN_VERIFIED/AI_ASSERTED; critical gates cannot pass on AI_ASSERTED alone.
No new credentials, model policy, billing, private-source installation, workflow authority, protection, Publisher, merge or publication permission. Independent AI09 changes use its approved repository route only.
Spec changes require owner and independent review. Rollback preserves Goal/history, restores compatible code/config/state together and re-verifies.
