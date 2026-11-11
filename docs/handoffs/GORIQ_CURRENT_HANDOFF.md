# GORIQ GitHub current handoff (Issue #1219)

Last reviewed: 2026-11-12 00:17 JST (2026-11-11 UTC)
Repository: haji84/AI- (public)
Canonical issue: https://github.com/haji84/AI-/issues/1219
Existing Draft PR: https://github.com/haji84/AI-/pull/1907
Branch: feature/1219-hosted-goal-job-routing-20261111
Reviewed implementation HEAD: d470c1498b8848ac7c74283ba5022cdd985aaf17
Reviewed PR base/main: 6737e15033eced135461076d72f792516e83c9b3
This handoff is a repository record, NOT an authenticated Compass Goal-state transition. The documentation commit following the reviewed HEAD requires its own exact-HEAD CI. Every future reader must refresh refs, statuses and logs.

## Owner's locked north-star GOAL

One authorized owner Goal is accepted once through Unified Intake and the existing Goal Resolver/Controller. GORIQ persists that same Goal; decomposes it into Jobs; selects the available, authorized capability; performs real AI implementation; diagnoses an actual failure; makes an evidence-backed different repair; obtains true independent verification; automatically resumes the next Job; and returns a usable, verifiable artifact. A process, GitHub Actions run, node, or host restart must not strand the Goal. Human Gates, pause, budgets, security and authority remain in force. The original production Goal remains NOT_ACHIEVED.

Existing owner Goal reference: goal-fcc81c97e09153f7
Existing Job reference: rotation-recovery-37
Their *live*, authoritative existence, state and approval scope have NOT been authenticated from Compass/Broker in this review. Do not recreate, reset, approve or claim execution of them from these text identifiers.

## Hard constraints

- Preserve GitHub as code/development evidence and primary suitable GitHub-hosted execution surface; no universal ZBook/MacBook prerequisite. Device/local/GPU-only jobs may wait for actual capabilities. No Codex, CodeRabbit or Copilot.
- Reuse the existing Issue #1219, Draft PR #1907, Goal Controller, Broker, resident execution path, Builder and verifier contracts; do NOT add a parallel production Controller, duplicate Goal/Job/PR, or pretend issue comments trigger runtime execution.
- Preserve all source, model, intent, candidate, original failure, receipt, attempt, checkpoint and signature evidence. Never clear consumed failed attempts to obtain another inference.
- Do not remove tests, add skips, relax 300-second Unit/Integration checks, independent verifier, scope/binding/signature rules, quotas or gates for an artificial PASS.
- No uncontrolled main merge, production switching, credential/key/scope/ACL/network/firewall changes, paid capability, security/governance changes, destructive changes or external publication without the matching current Human Gate. Public repository: do not store secrets, internal connection details or private owner data here.
- Only machine-reproduced behavior counts as completed. CODE IMPLEMENTED, CI GREEN, CI FIXTURE, real model inference, independent signed verification and real production Goal-E2E are different evidence classes.

## Architecture selected, not to be replaced

Authenticated existing endpoint/Broker -> GoalControllerRuntime / Compass -> scripts/jarvis-goal-executor.ts -> GoalControllerExecutionBridge / CompassGoalExecutionAdapter -> ResidentDevelopmentGoalHost -> authorized Builder + independently controlled Verifier -> canonical WorkRun/GoalEvaluator -> durable next-Job/recovery.

The hosted router selects candidates only; RUN_HOSTED does not establish execution authority. The source-only hosted adapter is not a second production Controller. Same-filesystem locks are not cross-run/cross-host ownership. Artifacts/caches alone do not confer a shared authority, lease, epoch or fencing.

Read AGENTS.md, PROJECT_STATE.md, ROADMAP.md, docs/decisions/2026-11-11-hosted-goal-routing.md and the corresponding audit before code changes.

## Verified change since the 2026-11-11 prior-chat handoff

Prior handoff reference HEAD: 374d65e7e2b1d2109ddf97f9cf5c3a1e9716fac1, run 43001898750. That exact commit failed restricted independent Unit at the unchanged 300000ms. Do NOT restart this diagnosis blindly or use the old 41-file inventory.

New reviewed PR HEAD: d470c1498b8848ac7c74283ba5022cdd985aaf17. PR remains Draft and unmerged; Issue #1219 open. PR changed-file inventory counted 73 entries at this check, including a test-file rename. The old PR description still discusses the preceding failed HEAD 1d59543; refresh exact HEAD before accepting its historical text as current.

Latest **exact implementation-HEAD** GitHub Actions CI: https://github.com/haji84/AI-/actions/runs/43044736792, completed SUCCESS. Its four jobs were all SUCCESS:
- repository-guard, job 130605577207
- project-checks, job 130605577070
- windows-runtime-byte-fixtures, job 130605577044
- independent-verifier-container, job 130605576625

The independent job log reports status PASSED, baseRevision d470c1498b8848ac7c74283ba5022cdd985aaf17, containerExecutionVerified true, **physicalAcceptanceVerified false**. Artifact ID 13867421248. The final correction was test scheduling and cleaning a leftover stop timer; see docs/evidence/1219-20261111-ci-scheduling-correction.json and commit d470c1498b8848ac7c74283ba5022cdd985aaf17. No CI success of this documentation-only follow-up commit is implied.

An earlier source-only two-Job GitHub-hosted process-restart integration fixture was successful at HEAD 1fba7e56, run 42946087355. It used a **synthetic fixture signer**, not authorized owner credentials or real independent production evidence. Do not promote that test's Goal to production evidence.

The real Ollama qwen2.5-coder:3b isolated experiment generated a real broken code candidate and a true SyntaxError; its failed attempt and re-read were retained. Corrected v2 verifier-packet transfer and definitive-FAIL runner are implemented. Neither the actual independent owner-controlled signing transport nor a successful second real repair is proven.

AI-09 GitHub advisory on latest HEAD remains BLOCKED: comment https://github.com/haji84/AI-/pull/1907#issuecomment-6799640507. The automation workflow can succeed while the advisory result is BLOCKED. It is not a GitHub APPROVED review, cannot sign real verifier receipts, and cannot grant merge authority. Formal PR reviews counted zero in this read.

## Remaining production acceptance, ordered by dependency

1. Authenticate the original live Goal/Job and current task-scoped permission/approval against canonical Compass/Broker. Previous repository evidence reports that the historical production origin returned DEPLOYMENT_NOT_FOUND; that is NOT proof the Goal, state or credentials are missing. Never guess absence from connector limits.
2. Connect a *real*, independently controlled signer/check runner transport through the existing verifier protocol and owner-pinned public identity, with candidate/base/artifact, Goal/Job, scope, deadline and all real check results bound. Builder must never access signer private key. Review available already-authorized assets first; an unapproved new credential remains gated.
3. Demonstrate a real shared durable authority/state path across separate Actions runs/hosts: full trial history, lease/epoch/fencing/CAS, duplicate/replay resistance, stale-owner rejection, pause/cancel/gate checks, crash recovery. Existing same-filesystem locks and copied CI artifacts do not establish this.
4. From an authorized external entrypoint, demonstrate the actual original Goal/Job (or an explicitly approved real acceptance Goal): real model code change -> genuine failed candidate -> different authorized repair -> independent signed evaluation -> automatic successor Job -> actual artifact and independent read-back. Keep Issue #1219 and PR #1907 open/Draft until production acceptance and applicable approvals.

Next actual engineering action: inspect the existing authoritative owner-intake/Broker read path and the already-present signer/distributed-state implementations on the exact newest PR HEAD. Identify one **actual** missing connection that can be changed within current authority, implement it in existing code, run exact-HEAD CI and independently retain evidence. If required owner credentials, scope or live store cannot be accessed, document the precise boundary and progress other authorized source work; do not invent availability, switch the production destination, or expand permissions.

## Key code and evidence locations

- Intake/control: scripts/jarvis-broker.ts, scripts/jarvis-goal-executor.ts, src/compass/store.ts, src/orchestrator/goal-controller-runtime.ts, src/orchestrator/compass-goal-controller.ts, src/orchestrator/goal-controller-execution-bridge.ts, src/orchestrator/work-run-state.ts.
- Runtime/host: src/orchestrator/compass-goal-execution-adapter.ts, src/orchestrator/resident-development-goal-host.ts, src/orchestrator/resident-development-admission.ts, src/orchestrator/hosted-goal-work-router.ts, src/orchestrator/development-resource-scheduler.ts.
- Model/verifier: src/orchestrator/tracked-repair-resident-runtime.ts, src/orchestrator/runtime-local-ollama-builder.ts, scripts/jarvis-independent-check-runner.mjs, scripts/jarvis-verifier-request-transfer.mjs, src/orchestrator/signed-local-verifier-receipt.ts.
- Governance/evidence: docs/audits/2026-11-11-goriq-hosted-model-connection.md, docs/audits/2026-11-11-goriq-execution-path-audit.md, docs/evidence/1219-20261111-ci-scheduling-correction.json, docs/evidence/1219-20261111-ollama-live-failure.json, docs/evidence/1219-20261111-verifier-connection.json.
- Prior 2026-11-11 handoff originally lived in a separate saved file; this GitHub record now provides its essential locked constraints and latest verified changes. Historical evidence is preserved on Issue #1219 and PR #1907.

## Mandatory protocol for EVERY new ChatGPT chat and outgoing handoff

**Entering the next chat**
1. Using the connected GitHub source, read this file at the actual PR branch/latest HEAD, Issue #1219 and its latest dated comments, PR #1907 current head/base/draft/changed paths/comments/reviews, AGENTS.md, PROJECT_STATE.md, relevant ADR and latest exact-head Actions jobs/logs. Prefer fetched branch refs to default-branch code search. Read any newly linked handoff before acting.
2. Compare this checkpoint with current GitHub rather than copying an old HEAD, test result, failure diagnosis or next action. Keep the existing Goal/Job and preserved failed attempts. Distinguish documented status from authenticated runtime status.
3. Continue the smallest safe implementation/test/verification on the existing PR, with no duplicate authority. Never stop at handoff repetition if an authorized engineering step is possible.

**Leaving for another new chat**
1. BEFORE ending the chat, write an updated GitHub handoff to this same file on the existing suitable development branch (or its exact successor after proper merge), AND post a concise Issue #1219 / existing PR #1907 checkpoint with the link.
2. Include the reviewed UTC/JST date, actual repository/main/PR HEAD, changed files/commits, CI run/job IDs and outcomes, actual model/Verifier/production evidence, achieved vs incomplete conditions, active blockers, permission gates, and one immediately executable next step. Never cite an old HEAD's CI as the current HEAD's acceptance.
3. Prefer a non-force commit and expected-HEAD compare-and-swap; on conflict, refresh and reconcile, never force overwrite. Read the committed file and PR/Issue comment back to confirm persistence. If write fails, explicitly report that GitHub handoff is NOT complete.
4. Do not equate posting this document/comment with executing or waking the canonical Goal Controller. GitHub handoff is durable context for the next chat; Issue #1219 still must connect authenticated intake to real autonomous execution.

## Rollback and current verdict

This file is documentation-only. Roll back only the added documentation commit if necessary, without disturbing PR runtime history or evidence. The verified source/CI correction is ahead of the old handoff. **GORIQ actual production Goal remains NOT_ACHIEVED** as of this documented review. Next task is live authoritative connectivity and independent signing/true cross-run authority, not more simulated success.
