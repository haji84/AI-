# GORIQ development load optimization (#1845)

> For agentic workers: use test-first implementation and one independent whole-branch review. Owner explicitly authorized autonomous implementation through protected main integration in the 2026-10-21 instruction; no repeated design or execution approval is needed within this scope.

**Goal:** reduce provably unnecessary ZBook work and safely defer incompatible heavy work under resource pressure using existing GORIQ contracts.
**Architecture:** preserve Goal Controller, WorkState, physical verification, existing CI and capability routing. Extend the existing resource model and use its predicate at fresh execution admission. Reuse cognitive-lease ownership logic for a separate host-wide heavy-work lane. Preserve resource waits in existing development job state and yield/resume through existing broker scheduling.
**Tech stack:** Node24 TypeScript, builtin OS/child_process/sqlite, Windows CIM/NVIDIA read-only probes, GitHub Actions standard hosted runners.
**Spec:** owner instruction and https://github.com/haji84/AI-/issues/1845; baseline cb6b0fa06492b3d610ecb527645244b9a46ba8eb.

## Global constraints
- Parent #681/#1219 and product requirements unchanged; no new daemon, hosted controller, paid/model API fallback or larger runner.
- No raw Windows logs, prompts, credentials, usernames or host paths in public evidence.
- No services/VMs/worktrees stopped, reset or deleted; no installer execution or runtime deployment.
- No permissions/deployment/security/governance changes. Retain exact-head checks, independent review and physical evidence boundaries.
- One issue/branch/PR. PR1770/1764 lock/continuation and PR895 resource routing remain separate prior work; no duplicate autonomy lock.
- Local checks serial and targeted. Full lint/test/security/build on existing hosted CI. At most three automatic fix attempts per issue per owner instructions.
- Human approval source is the exact owner task. Apply an agent-imposed conservative expiry of 2026-10-22T12:16:36Z for this run's task-scoped completion authority; no extension to other tasks or Production deployment.

## Review focus
Unknown/stale/nonfinite telemetry fails visibly when required; commit exhaustion may coexist with available RAM; lock is shared across processes and reclaimed only for a proved-dead local owner; pressure wait preserves changes/TDD and does not consume failure attempts; pause/authorization/genuine test failure never become successful auto-resume.

## Task 1 — baseline and safe audit
- [x] Read Compass and exact main governance, roadmap, relevant issue/architecture/decisions; preserve dirty primary checkout.
- [x] Create isolated native worktree and issue1845 after open PR/issue deduplication.
- [x] Save all75 workflows/135 jobs classification and bounded run-history metrics. Record observed hosted CI vs self-hosted recovery overlap with Windows evidence, and missing historical CPU/RAM metrics.
- [x] Record official runner/cache/artifact cost boundaries and sanitized CONFIRMED/PROBABLE/UNKNOWN diagnosis. Do not claim a memory leak.

## Task 2 — execution admission and telemetry
Files: src/gai/worker-runtime.ts, src/gai/worker-resource-probe.ts (new), src/gai/development-resource-admission.ts (new); focused tests.
Interfaces: WorkerResourceSnapshot gains optional measured commit/disk/GPU-memory fields; existing evaluator handles additive requirements. Probe returns { checkedAt, resources }. ResourceWaitError carries outcome {status:WAITING_FOR_RESOURCE, reason, retryAfterMs, observedAt, resources?}. withDevelopmentResourceAdmission(work, options) acquires a separate host-wide cognitive lease, freshly probes, evaluates, executes and releases in finally.
- [x] RED: commit pressure despite free RAM; CPU/RAM/GPU/disk, stale/unknown/NaN; no callback on rejection; cross-process exclusivity, release after errors/dead-owner recovery.
- [x] GREEN: minimum implementation with bounded probe subprocesses and safe telemetry only; no fail-open override in production.
- [x] Verify targeted tests serially, save commands/results.

## Task 3 — existing runtime integration and bounded continuation
Files: existing Builder service/install packaging, PrimaryBrain/direct Ollama seams as applicable; resident-development-goal-host, goal-controller-execution-bridge, jarvis-goal-executor, existing broker scheduling; focused tests.
- [x] RED: resource wait propagates over existing HTTP result; preserves durable ChangeSet and TDD, consumes no failed strategy; process recreation and relief resumes once; retry/deadline bounded; pause/Human Gate prevents resume.
- [x] GREEN: use shared admission at real build/verify/local-model boundaries and existing WAITING_FOR_RESOURCE transitions, not mock success. Do not install or restart live services.
- [x] RED/GREEN: deduplicate only identical unit/integration command executions while retaining all required check evidence; bound accumulated Builder stdout/stderr by total size.
- [x] Verify existing affected integration/security tests plus packaging dependency closure.

## Task 4 — reject unnecessary self-hosted recovery work early
Files: goriq-pr-ci-recovery workflow/script shared path policy/preflight helper and focused tests. Owned independently from Task2 files.
- [x] RED: no repairable path allocates no ZBook; stale/new head never borrows old evidence; queue-time stale recheck happens before dependencies; paginated changed files; trusted control only.
- [x] GREEN: reuse exact existing allowedRepairPaths policy in hosted preflight and preserve runtime checks/permissions/security/review behavior. Revalidate before heavy local install.
- [x] Verify recovery regression and workflow contracts serially.

## Task 5 — integration, independent review, protected merge
- [x] Run targeted integrated checks, local read-only collector/canary and privacy scan. No stress test or fake device PASS.
- [ ] Independent whole-branch review; fix actionable issues with evidence and bounded attempts.
- [ ] Commit/push scoped branch; create exactly one PR1845 and attach it to this chat. Full existing hosted CI/lint/security/build, reviews and unresolved threads checked on latest head.
- [ ] Integrate only when required checks, task scope, non-destructive/non-privileged classifications and mergeability pass. Verify exact main CI afterwards.
- [ ] Run safe latest-main native checks without deploying/copying over services; record before/after observations and unobserved long-run effects separately. Write back Compass/state-only bookkeeping and next action. Never call freeze prevention proven.

## Rollback
Source rollback requires a reviewed revert that preserves the separately approved native-mutation fences. Automatic installs did change live state after PR1847; any native restoration needs read-only assessment and separate authority. A source revert alone must not be assumed to restore services. No native rollback was attempted. Preserve pre-existing worktrees, uncommitted files, logs and VM state.

## Progress ledger

### Separately approved concurrency event isolation

Owner explicitly selected 「追加3行の検証・統合も承認する」 for the prepared3-line patch9d9a5e69e2de186a36c73320aa297414af4b082e0eed6d2b01660f5130f263cd. Reuse Issue1845; PR1849 was already merged, so use a minimal follow-up branch/PR from main c4aa4194910b57d529bb1fdbe33db613801b4296. Scope/expiry remains this issue only through2026-10-22T12:16:36Z. No native dispatch, runtime install/restart/restore, deletion, secret/permission/billing change is authorized.

Minimum plan: reproduce the push/manual cancellation-group collision; apply only the three approved group lines; retain same-event cancel-in-progress, all job conditions/steps/permissions; run related regression checks and independent review; verify exact-head hosted CI and protected main CI; observe automatic native jobs remain skipped without launching manual work. Risk MEDIUM within the explicit Human Gate: workflow concurrency behavior changes but no runtime operation is requested. Before merge check for already-running manual jobs using the legacy group. A rollback would restore cancellation coupling and requires a separate reviewed decision; do not remove native-start fences or restore runtime automatically.

The owner asked what folder the artifact cleanup question concerns. Explained that GitHub artifacts/logs contain personal-folder path strings; no actual user folder, development repo, VM data or local diagnostic backup is proposed for deletion. The exact4 GitHub data-object cleanup is still unapproved and NOT performed. Preserve incident FAIL305 and unresolved Mac/allocator/long-run boundaries.

Local verification: three new collision regressions RED9PASS/3FAIL, then GREEN12/12 after exact patch. The legacy repair-runtime source assertion still required the old fixed group; updated it to require the exact approved event-qualified group, retaining cancel-in-progress and the unrelated autonomy assertion. Related29/29PASS260.2ms; scoped ESLint and git diff --check PASS. Commands: `node --test --test-concurrency=1 tests/1845-native-trigger-fences.test.mjs tests/goriq-repair-engine-runtime.test.ts`; ESLint on the two changed test files using existing installed dependencies. No new CI fix attempt was consumed by changing this obsolete source contract; earlier issue CI repair attempts remain2/3. Hosted CI/review/main evidence belongs to this follow-up's exact final head.

### Separately approved native-trigger containment

PR1847/main accf8294 passed hosted CI but triggered existing native installer/upload jobs, breaching the task constraint. Completed steps cannot be undone by cancellation; Mac Bootstrap partial effects and uploaded-artifact privacy remain unreviewed. Issue1845 was reopened, Compass recorded task-safety FAIL/HUMAN_GATE, and the PR description corrected. No manual reinstall/restart/restore/deletion was attempted.

The owner explicitly selected 「この差分の検証・統合まで承認する」 for the reviewed7-workflow/14-job-if proposal, SHA2565fcfffd391f95fbde0332db734aa866fabc1329ed2671257db3fbdeb2e3c4740. This separate Human Gate authorizes only these deployment-control restrictions plus necessary tests/evidence, protected PR integration and main CI. Expiry remains2026-10-22T12:16:36Z. No runtime operation, secret/permission change, paid activation, restore or deletion is authorized.

Bounded plan: (1) behavioral RED for all automatic events and positive manual paths; (2) apply exact approved patch; (3) verify all non-job-if workflow bytes and existing authorization implementation unchanged; (4) related authorization/security/trigger regressions and scoped lint; (5) independent review, latest-head hosted CI, protected merge/main CI; (6) observe all affected automatic native jobs skip without dispatching any workflow. Correct the earlier no-install evidence and retain incident/diagnostic unknowns.

Verification so far: new behavioral suite RED1PASS/8FAIL then GREEN9/9; related regressions152PASS/0FAIL/1existingSKIP1841.6ms. Two legacy workflow-contract test files now assert the approved manual-only policy while preserving exact source/CI/expiry/step checks; CRLF-safe matching retains the original per-step guards. Scoped lint/diffcheck PASS. No live workflow/model/service was invoked by this follow-up.
2026-10-21 baseline: public repo; main cb6b0fa; normalCI3 hosted jobs. 124 runs fetched for2026-10-21UTC; source metrics absent. Self-hosted recovery39572807594 overlaps first memory-exhaustion episode; temporal association does not establish allocation culprit. Detailed Windows evidence remains local.

2026-10-21 implementation: integrated serial194/194 PASS11795.6ms; scoped lint/changed TS graph/diffcheck PASS. P1 in-flight Human Gate overwrite and P2 disk-filesystem mismatch reproduced and fixed before integration. Read-only native probe2328ms, no new selected crash/resource signals since21:10JST. No installer/service/model/stress operation performed. Full hosted CI/review/main receipts pending on the PR.
2026-10-21 CI repair attempt1/3: hosted2609 tests had2596PASS/8FAIL/5baselineSKIP because13 changed reverse-audit hashes and4 new surface mappings were missing. Explicitly reconciled only these17 reviewed entries against existing canonical parents;563 unrelated rows, requirement/status/evidence and audit enforcement unchanged. Local matching18/18 PASS9305.3ms. No production/runtime code changed by this CI repair.
2026-10-21 CI repair attempt2/3: latest94a93a8e full hosted test2604PASS/0FAIL/5baselineSKIP and security332/332PASS; build typecheck rejected3 fixture ProcessEnv literals missing Next-required NODE_ENV. Added NODE_ENV=test to those test-only literals. Scoped compiler with Next global declarations PASS; focused worker7/7PASS1403.2ms. No runtime, requirement, test-assertion or guard change.
