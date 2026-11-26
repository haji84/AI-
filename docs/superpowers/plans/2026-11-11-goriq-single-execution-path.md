# GORIQ existing execution path integration plan

> **For agentic workers:** Use the existing Issue #1219 / PR #1907 worktree. Follow `superpowers:executing-plans` and `superpowers:test-driven-development`; obtain independent review before publishing. Do not create another Goal, execution authority, verifier, or PR.

**Goal:** Connect per-Job routing to the existing authenticated intake and durable Goal execution path, preserving verified progress, bounded recovery, and all authority gates.

**Architecture:** Retain `GoalControllerRuntime`, Compass, `CompassGoalExecutionAdapter`, and `ResidentDevelopmentGoalHost` as the authoritative path. Reuse `routeDurableGoalJobs` as admission to that existing runtime. The separate hosted adapter's fixture proof is not a second production controller.

**Tech stack:** Existing Node 24 / TypeScript / SQLite / GitHub Actions. No new dependency or external provider.

**Spec:** Issue #1219, `AGENTS.md`, `PROJECT_STATE.md`, `docs/architecture/general-autonomous-ai-dynamic-orchestration.md`, and `docs/decisions/2026-11-11-hosted-goal-routing.md`. Owner request on 2026-11-11: inspect the GitHub repository and connect the existing production intake -> durable state -> real AI implementation -> independent verification -> successor Job -> usable artifact.

## Global constraints

- Preserve the existing Goal ID, Job IDs, State Controller, Compass authority and task-scoped approvals.
- Use the existing PR #1907; main baseline `6737e15033eced135461076d72f792516e83c9b3`, PR baseline `1fba7e56bdadfbe5aac6bf3c5741501d373ea6fb`.
- No Codex, CodeRabbit, or Copilot fallback in the hosted execution selection.
- No new credentials, permission expansion, paid capability, protection bypass, or public runtime data publication.
- A missing production capability remains an explicit blocker. Source integration, fixture tests, live model inference, signed independent acceptance and production delivery are separate evidence classes.
- No routine confirmation for authorized source fixes. Provisioning/activation that changes authority is a separate, concrete final gate after code and verification are reviewable.

## Audit baseline

- Main has 1,949 tracked files; PR #1907 has 1,956. There are 229 remote refs including `origin/HEAD`; all-author REST pagination confirmed 111 open PRs (the initial account-only result had 109).
- Latest PR baseline CI `42946087355` is successful, including the independent-container job. This does not establish production verifier authority.
- `autonomy-mobile.yml` runs a different legacy loop; scheduled mode is `status`. Its generic `result.ok` check is not independent verification.
- `jarvis-goal-executor.ts` constructs `CompassGoalExecutionAdapter` with the resident runtime. The new hosted adapter has no production consumer.
- Canonical progress projection already exists in `CompassGoalExecutionAdapter`; retain it instead of granting a callback authority to mark arbitrary criteria complete.
- Concurrent Goal intake and recoverable verification handling have reproducible source defects that must be fixed before enabling another caller.

## Review focus

- Concurrent distinct submissions must not both acknowledge durable acceptance while one overwrites the other.
- Resume/replay must not dispatch a completed, paused, human-gated, foreign or already-owned Job.
- Failed/missing/forged independent evidence must remain distinct; only a genuine recoverable failure may trigger bounded repair.
- Hosted routing must verify the selected host and explicit scope; an offline physical worker must not block unrelated eligible work or grant a cloud capability.
- Goal completion must derive from persisted criterion-specific acceptance, not a route selection, Builder success, or count of completed Jobs.

## Task 1: Atomic durable intake

**Files:** `src/compass/store.ts`, `src/orchestrator/compass-goal-controller.ts`, and focused existing/new intake tests.

**Interfaces:** Preserve existing GoalRegistry and GoalControllerRuntime contracts. Add a synchronous transactional create-if-absent operation at the SQLite authority if needed; do not add a schema or a second registry.

- [x] Reproduce concurrent distinct Goal submissions and same-request replay using real Compass stores.
- [x] Ensure only a durably bound Goal may be acknowledged; reject the conflicting active Goal without overwrite.
- [x] Run focused intake, persistence and controller tests; record RED/GREEN evidence.

## Task 2: Bounded verification recovery on the canonical runtime

**Files:** `src/orchestrator/resident-development-goal-host.ts`, existing recovery and bridge tests; executor outcome mapping only if required by the verified cause.

**Interfaces:** Retain `BoundedRunReport` and persisted DevelopmentJob failure/strategy history. Use existing continuation budgets and State Controller transitions.

- [x] Reproduce a real failed verification result that persists `RECOVERING` but is incorrectly reported as a terminal blocker.
- [x] Return a recoverable continuation only for explicitly diagnosed independent-check failures; preserve missing-receipt wait and every security/Human Gate.
- [x] Prove changed-candidate repair, same-candidate rejection, bounded exhaustion, pause and restart behavior through the existing execution bridge.

## Task 3: Route at the existing execution boundary

**Files:** `src/orchestrator/resident-development-goal-host.ts`, `src/orchestrator/hosted-goal-work-router.ts`, the existing runtime configuration path, and focused admission tests.

**Interfaces:** A host-owned admission contract checks the actual selected Job before implementation and resume; use existing persisted Jobs and the existing router. It must not receive execution authority from Goal text or model output.

- [x] Add behavioral tests proving denied/waiting/human-gated/unverified dependencies never reach Builder.
- [x] Wire per-Job routing to the resident runtime without replacing its Builder, verifier, release, recovery or progress projection.
- [x] Revalidate admission before later side effects; make missing host configuration explicit and fail closed.
- [x] Verify the production caller selects this integration, not only a test constructor.

## Task 4: Whole-repository audit and exact-revision verification

**Files:** A scoped audit/evidence report, canonical traceability entry if implementation paths require it, and PR #1907 metadata.

- [x] Inventory all tracked paths/workflow files/remote refs and open PRs, and record detailed-review coverage rather than claim every historical line was read.
- [x] Compare relevant unmerged PRs with the current baseline; do not pull unrelated Windows, credential or device changes into #1219.
- [x] Obtain independent design/code review and fix substantive findings.
- [ ] Run required repository checks on the actual candidate, publish to the existing branch, and inspect exact-head CI results.
- [ ] State remaining real-model, independent signer, off-run persistence and activation conditions using actual evidence; do not mark Issue #1219 achieved without the real accepted-Goal E2E.

## Rollback

Revert only the integration commits in PR #1907. Preserve Goal/Job histories, failed candidates and verifier receipts. No database migration, runtime service, credential, permission, workflow activation or production data mutation is included in this source repair.

## Local verification checkpoint

The source integration and independent review are complete. The real Broker/executor fixture now also selects the pinned hosted admission and proves restart, signed-receipt wait, successor Job and artifact file readback with explicitly synthetic inference/signing. Full local tests: 3,660 total, 3,632 pass, 2 environment failures, 26 conditional skips. The same two network-interface failures reproduce on untouched main6737e150. P8 security: 332/332; traceability/audit: 18/18; lint, TypeScript and production build pass. Final publication/CI evidence belongs to PR1907's actual head, not the old baseline run.

Actual hosted activation, off-run shared authority, production signer and attempt-aware real-model repair remain acceptance gaps. The source result must not close Issue1219 or mark the real Goal achieved.
