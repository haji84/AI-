# GORIQ current development handoff: Issue #1219 / Draft PR #1907

Reviewed 2026-11-12 JST. This file records source work, not an authenticated Compass state change or production completion.

## Identity and first action

- Repository: haji84/AI- (public).
- Existing Issue: https://github.com/haji84/AI-/issues/1219
- Existing Draft PR: https://github.com/haji84/AI-/pull/1907
- Existing branch: feature/1219-hosted-goal-job-routing-20261111
- Reviewed parent: `f17a52c25597656afcbc9bb42568f3b50356cabc`; tree `a1d7317790f74f748b571e45440a46920bb11326`.
- Reviewed main: `6737e15033eced135461076d72f792516e83c9b3`.
- This source/test/evidence/handoff commit creates a NEW HEAD. Fetch its exact SHA and all four required jobs; neither a parent result nor these local regressions accepts the new HEAD.
- The previous handoff is preserved byte-for-byte at [GORIQ_HANDOFF_f17a52c_ARCHIVE.md](./GORIQ_HANDOFF_f17a52c_ARCHIVE.md), Git blob `3eba3a5c6b04c38df300202449e897dbc4fad5f6`. It links the earlier 433d36c archive and retains original failures and constraints.
- Read [GORIQ_GOAL_TO_PRODUCTION_GATES.md](./GORIQ_GOAL_TO_PRODUCTION_GATES.md). Its historical G0 success at 5c07a01 is NOT a current acceptance.

## Locked final Goal and boundaries

One authenticated owner Goal must be accepted once, persisted by the existing Unified Intake/Goal Resolver/Controller, turned into eligible Jobs, implemented by an actual authorized model, independently verified, genuinely repaired after FAIL, resumed after process/Actions/host loss, continued to the next Job without another owner instruction, and delivered as a usable artifact with independently checked bytes and behavior. Preserve pause/cancel, budgets, approval and all Human Gates.

Historical original identifiers: `goal-fcc81c97e09153f7` / `rotation-recovery-37`. Their current live existence, contract, scope and approval have NOT been authenticated here. Do not recreate or approve them from this text.

Reuse authenticated Broker -> GoalControllerRuntime/Compass -> jarvis-goal-executor -> GoalControllerExecutionBridge/CompassGoalExecutionAdapter -> ResidentDevelopmentGoalHost -> authorized Builder/independent Verifier -> canonical state/continuation. No duplicate controller, Goal, Job, Issue or PR. Public repository and GitHub-hosted priority remain; no universal PC dependency. Do not introduce Codex/CodeRabbit/Copilot.

## Actual source correction in this commit

The existing owner probe previously validated an explicitly requested Job from one local response. It did not compare a second authenticated observation of the contract, approval and stop state, as needed for G1 readback consistency.

`scripts/goriq-ai09-live-broker-builder-probe.mjs` now makes exactly one additional authenticated GET only when an explicit Job is supplied. It validates both observations and compares current Goal identity, contract digest, WorkRun phase, selected Job identity/phase/record SHA, task scope, risk ceiling and optional expiry. It normalizes field order and ignores unrelated Job ordering. A changed snapshot returns HOLD/JOB_READBACK_CHANGED; a second-read transport/auth/parse failure returns HOLD/JOB_READBACK_REPEAT_UNAVAILABLE. Invalid first snapshots keep the old refusal. Stable HUMAN_GATE stays a gate.

Goal-only and Builder-only paths keep their existing request counts. Exact loopback endpoints, GET-only requests, redirects rejected, existing credentials, per-request timeouts and bounds are unchanged. New localReadbackConsistent and goalContractDigest fields are observation evidence only. A double local read is NOT a remote lease, independently signed proof, permission to execute, Builder acknowledgement or completion.

No Broker mutation, new service, workflow, permission, secret, signer, database migration, resource quota, test timeout, main merge or deployment was performed. Existing tests were not deleted, skipped or weakened.

## Tests and limits

- New regression file: tests/ai09-owner-job-readback-consistency.test.mjs, 23 cases.
- RED against the exact previous probe: 22 expected failures, 1 pass, 0 skips, exit 1.
- GREEN including the six unchanged owner-current-proof tests: 29 pass, 0 failures, 0 skips, exit 0.
- Source and test syntax checks passed. Final test uses globalThis.AbortSignal to respect the actual ESLint globals boundary for tests.
- Local environment: Node v22.16.0, partial source workspace, not the pinned Node24.19.0 full repository/Docker environment. Full repository tests, independent source review, actual owner host, production Goal and physical recovery are NOT verified by this result.
- [Machine-output summary and hashes](../evidence/1219-20261112-job-readback-consistency.json). Source Git blob `7e917ef2885887d37e2e30098dc595b67967ea1b`; new test blob `1cf67d3df4243e2275a150a66560093928c7ec13`.

## G0 evidence and actual retry result

The parent f17a52c CI [43095664141](https://github.com/haji84/AI-/actions/runs/43095664141) was still queued on the last pre-change check. Its no-job queue state is distinct from a Unit timeout. This new commit contains a substantive source repair, not an empty queue-nudging commit.

On earlier source b2adfc9aec13792e9b42e88dc9fb8636d04b1543, CI [43094319584](https://github.com/haji84/AI-/actions/runs/43094319584) attempt 1 completed all six checks but failed both CreateArtifact uploads. A single existing-job retry was requested for that evidenced transport failure, without changing source, timeouts or quotas.

Attempt 2 independent job `130894886237` finished. BOTH evidence-upload steps succeeded. Downloaded verifier artifact `13906105186` has SHA256 `20676d72a15090923182a3f5f4140b4d6d9c49cff39c6a9c30d20addd29781ce`, matching the upload log. Its CI-fixture public-key signature and all three retained check-log hashes were verified. Lint/typecheck passed; Unit was INCONCLUSIVE at 300008.472651ms with ETIMEDOUT/SIGKILL, close and cleanup confirmed. Integration/security/build were absent after the bounded stop. Other three CI jobs succeeded. Therefore this parent retry is FAILED, not a six-check pass. Do not repeat unchanged attempts merely to obtain green.

The artifact's real startup probe showed the image-owned compile cache already enabled and six imports taking approximately 65-97ms each. Adding another compile cache is not a supported fix. The original timeout remains unsolved. An upload succeeded in this attempt; the original transport root cause and general recovery are not proven. Fixture signatures never count as the production independent signer.

## Remaining gates and next bounded work

G0 remains unaccepted until exact new-HEAD CI, all six independent checks and retained evidence pass. G1 remains HOLD_LIVE until the original Goal/Job can be read twice on an already-authorized actual host. G2/G4/G5/G6/G8/G9/G11 remain partial source, not original-Goal completion. G3/G7/G10/G12/G13 remain HOLD_LIVE.

1. Fetch the new PR HEAD and exact-head Actions jobs/logs; inspect the first real failure, including traceability, before further patches. Preserve the original Unit and upload failures.
2. Use attempt-2 Unit output and controlled same-source measurements to isolate costly work under the unchanged 2CPU/2GiB/128PID, 300-second bounds. Do not delete tests, add skips, relax limits, or attribute all timing variation to an unverified cause.
3. For G1, use an already-authorized live Broker/Compass read path with explicit original Goal and Job IDs, and compare current contract/approval/stop state. The existing main-only read-probe workflow does not run unmerged PR source; do not change it to execute untrusted branch code with owner credentials. Source integration/authorized delivery remains necessary. No direct GORIQ/Compass plugin was found; this does not prove runtime or credentials are absent.
4. After authority is actually established, connect the existing independently controlled signer and true shared durable CAS/epoch/fencing/attempt-history store under matching approval. Prove real signed FAIL -> different candidate -> verification -> cross-host resume -> next Job -> artifact and behavior. Same-filesystem locks/artifact copies are not cross-host authority.

No production acceptance or completed G0-G13 gate is added by this commit. Separate review, current authority, secrets/permissions, billing, destructive changes and production activation gates remain in force. Do not infer approval from a green fixture or a repository comment.

## Handoff and rollback

Read AGENTS.md, PROJECT_STATE.md, ROADMAP.md, Issue1219/current comments, exact PR/CI, routing ADR and gate map before continuing. Refresh rather than copying historical status. Preserve old attempt evidence and original Goal/Job history. Before leaving, record exact HEAD/run/job IDs and remaining blockers in this file plus the existing Issue/PR, then read them back. Prefer non-force expected-HEAD updates; reconcile races. Repository handoff is context, not a runtime wake or authenticated state transition.

Rollback only this bounded probe/test/document change if required. Retain both handoff archives, failed CI runs and all original model/candidate/receipt history. Do not revert owner state or recreate the Goal. Keep PR1907 Draft and Issue1219 open until actual acceptance and applicable approvals.
