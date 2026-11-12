# GORIQ current development handoff: Issue #1219 / Draft PR #1907

Reviewed 2026-11-12 JST (2026-11-11 UTC). This is development evidence, NOT a live Compass transition, an execution grant, a production acceptance, or a declaration that the original Goal exists in its current authoritative store.

## Read these before continuing

- Repository: haji84/AI- (public).
- Existing Issue: https://github.com/haji84/AI-/issues/1219
- Existing Draft PR: https://github.com/haji84/AI-/pull/1907
- Existing branch: feature/1219-hosted-goal-job-routing-20261111
- Reviewed base/main: `6737e15033eced135461076d72f792516e83c9b3`.
- Latest implementation checkpoint reviewed before this documentation commit: `b2adfc9aec13792e9b42e88dc9fb8636d04b1543`.
- Its CI: https://github.com/haji84/AI-/actions/runs/43094319584 . At this document's preparation, the independent verifier had NOT finished. Normal test/security/build/health steps had succeeded; Windows fixture and repository-guard jobs had succeeded. Do not turn this observation into a complete CI pass.
- THIS DOCUMENT CREATES A NEW HEAD. Refresh the PR HEAD and its own four required jobs, source bindings and logs. Neither the reviewed parent nor an older successful SHA accepts the new HEAD.
- The preceding full handoff is preserved byte-for-byte as [GORIQ_HANDOFF_433d36c_ARCHIVE.md](./GORIQ_HANDOFF_433d36c_ARCHIVE.md), Git blob `4d9ac952ed9ead357507676b0b4fa0be31e84079`. It retains prior source changes, failed approaches, immutable evidence links and historical verification. Read it with the current checkpoint, not as current runtime truth.
- [GORIQ_GOAL_TO_PRODUCTION_GATES.md](./GORIQ_GOAL_TO_PRODUCTION_GATES.md) remains the detailed G0-G13 acceptance map. Its historical G0 SOURCE_CI_PASS at `5c07a01` must NOT be applied to another HEAD.

## Locked final Goal and authority

An authenticated owner submits one Goal once. The existing Unified Intake/Goal Resolver/Controller persists that same Goal, selects eligible Jobs, performs actual model-produced changes, diagnoses genuine failures, makes a different authorized repair, obtains truly independent verification, resumes after process/Actions/host loss, starts the next Job without another owner instruction, and delivers a usable artifact whose bytes and actual behavior are independently checked. Human Gates, pause/cancel, budgets and authority remain enforced. No completed Job or green source CI completes an unfinished Goal.

Historical owner identifiers: `goal-fcc81c97e09153f7` / `rotation-recovery-37`. Their live canonical existence, present contract, scope and approval have NOT been authenticated in this continuation. Never recreate or approve them from this text.

Keep the existing path: authenticated Broker -> GoalControllerRuntime/Compass -> jarvis-goal-executor -> GoalControllerExecutionBridge/CompassGoalExecutionAdapter -> ResidentDevelopmentGoalHost -> authorized Builder and independently controlled Verifier -> canonical WorkRun/GoalEvaluator -> durable continuation. Hosted routing is selection, not authority. No second controller, duplicate Goal/Job, Issue or PR.

## What changed in this continuation

GitHub file/tree/commit/ref write actions were available. The earlier chat's absence-of-write-tools limitation is not the current limitation. Actual changes were written to the existing PR, not main.

1. `5ef55228aef922f18aec2a40afa047dcab90bd10` added `tests/goriq-compile-startup-observation.test.mjs`, a bounded source-import observation. It does not cache test results or authorize acceptance. CI https://github.com/haji84/AI-/actions/runs/43093182673 failed: the added file omitted explicit process/console imports, producing six no-undef lint errors. This was an introduced diagnostic defect, NOT evidence that the old timeout was fixed or an intentionally planned production RED test.
2. The existing pinned verifier image was then inspected. It ALREADY enables a private, image-owned Node compile cache through prepare-home.cjs and rejects externally enabled/disabled cache state. Therefore adding another suite cache or launcher was rejected; it would duplicate existing behavior and conflict with the guard. No package script, Dockerfile, workflow, timeout, quota or cache guard was changed.
3. `b2adfc9aec13792e9b42e88dc9fb8636d04b1543` fixes the explicit imports and observes an existing cache WITHOUT overriding its environment or preload. Only an unguarded environment receives a new temporary comparison cache. That directory alone is removed. Exact returned Git blob: `60ae1c078ca4538ae328e5e687a3567a98686195`.
4. A local Node22.16.0 mechanism regression reproduced the incompatible old probe against a disposable fake preload guard, then passed the corrected guarded and unguarded variants. Dummy TypeScript modules were used ONLY for this mechanism test. This is NOT Node24.19.0 full-source CI, not the real verifier image, and not owner-runtime acceptance. Local syntax checks also passed.

The original 18-test diagnostic candidate from the preceding chat has NOT been integrated into the production live-CI script. Do not claim otherwise. No production runtime function was modified in this continuation. No optimization has yet been accepted as a causal fix for the original Unit timeout.

## Retained failure evidence and limits

Original source HEAD `433d36c00218f5f103a28566c355cfaf85dad5c9`, CI https://github.com/haji84/AI-/actions/runs/43077120854:
- Main project, Windows fixture and repository-guard jobs succeeded; independent verifier failed.
- Actual Unit log: timeoutMs=300000, elapsedMs=300011.129654, ETIMEDOUT/SIGKILL, close and cleanup confirmed, receipt inconclusive. Integration/security/build were absent after that bounded stop. Missing checks are the symptom; Unit's incomplete execution is the prior failure.
- Artifact 13883221364 SHA256 `d7afcc16d13b1852eb6352448c30bb4999ab89f7da2e2b9e8c242f1c62dde834`.
- Supplemental resource artifact 13883121411 SHA256 `35a568d01e9c89780f1afa032ae1c2a6cfed391dfbebad268d6793cbb034ea6a`. It is UNSIGNED_SUPPLEMENTAL, PARTIAL and non-accepting. CPU quota throttling is visible; this alone does not establish why this run exceeded the deadline.
- Historical successful HEAD `5c07a013f8ccc1864a8fbe51c6cecda5ba1040a2`, CI43064482325, recorded Unit elapsed244352.91775ms. Its source and host differed. Do not attribute the timing delta to a particular change without a controlled comparison, or reuse that pass for another HEAD.
- The initial new observation's failed CI43093182673 artifacts are retained by Actions: verifier13890013623, advertised SHA256 `4bdb0ba8709709bd2b50f59d9a4d54baacf9bed943f07baa32f9c679f7387b3e`; observer13889753846. Two connector download attempts for the verifier ZIP timed out. The new ZIP bytes and per-check details were NOT independently read in this review. The advertised digest is metadata, not a completed local verification.

The local workspace was a PARTIAL source candidate, not a clone. Its Node22 runtime, absent Docker/pwsh/pnpm and unavailable container GitHub DNS did not reproduce the required pinned six-check environment. No full local suite was claimed. GitHub's existing CI is the actual full-source execution path.

## Current gate interpretation

G0: pending latest exact-HEAD all-job acceptance; original timeout's permanent resolution not proven.
G1: HOLD, live authenticated original Goal/Job and current approval readback unproven.
G2: partial source, actual owner intake-to-Job execution unproven.
G3: HOLD, shared durable authoritative store/CAS/epoch/fencing/append-only attempt history across hosts unproven.
G4: partial source, actual runner loss and same-Job cross-host continuation unproven.
G5: partial source, isolated real Ollama failed candidate exists historically; original Goal's successful real repair unproven.
G6: partial source, actual original attempt/candidate/receipt preservation and independent cross-run readback unproven.
G7: HOLD, independently controlled production signing/transport and owner-pinned identity unproven.
G8: partial source, real complete signed FAIL -> different authorized candidate -> independent acceptance unproven.
G9: partial source, actual original Goal's automatic successor Job unproven.
G10: HOLD, protected approved integration/release and exact production artifact unproven.
G11: partial source, final actual artifact delivery and behavior verification unproven.
G12: HOLD, real process/host/Actions/network/conflict failure injection and recovery unproven.
G13: HOLD, full actual Goal end-to-end and repeatability unproven.

Historical CI/fixture signed receipts, advisory AI09, real model download/inference, local helper tests and workflow success are distinct evidence classes. Windows CI is not a physical owner Windows reboot test. Neither G1-G13 nor a production Goal was completed here.

## Next executable work

1. Read the current PR/ref and exact-head CI. Inspect the first real failure and its retained check log; do not rerun unchanged solely to obtain green. If CI passes, record the exact SHA/run and six actual checks, but do not claim a permanent performance fix from one observation or promote it to production acceptance.
2. Read the startup observation from the actual Unit log. It now reports source hashes and whether a cache was initially enabled. Do not propose adding a cache to the verifier again: its trusted image already owns one. Use actual same-environment evidence to identify avoidable work without deleting/skipping tests, changing assertions or raising the 300-second Unit/Integration bounds.
3. In parallel with authorized source work, identify an ALREADY authorized live Broker/Compass read path and verify the original Goal, Job, digest, scope, stop state and approval. A GORIQ/Compass plugin search in this chat returned no matching tool; that is not proof the service, store or credentials do not exist. Do not create a new identity, copy secrets into chat/public GitHub, guess missing settings, or use a stale public deployment as runtime authority.
4. After exact-source and live authority are established, connect existing independently controlled signing and shared state through current contracts, preserve all failed attempts, and perform real failed-candidate repair, restart recovery and next-Job acceptance. Stop at an actual Human Gate rather than manufacturing approval.

## Non-negotiable boundaries and next-chat protocol

Read AGENTS.md, PROJECT_STATE.md, ROADMAP.md, Issue1219, current PR/comments/reviews, this handoff, the archived handoff, the routing ADR and gate map before changing code. Prefer exact-HEAD fetches: default-branch search was indexed at an older commit in this review.

Keep public GitHub and GitHub-hosted priority without a universal PC dependency. No Codex/CodeRabbit/Copilot dependency. Device/GPU-only work requires actual authorized capability. Same-filesystem locks and copied artifacts are not cross-host ownership. Keep Builder away from signing keys; preserve exact source/candidate/artifact/Goal/Job/scope/expiry bindings and every real verification result.

No unapproved main merge, release, deployment, credential/key/permission/ACL/network/firewall change, paid service, destructive migration or external publication. Preserve protected existing owner services/ports/worktrees. No new task automation was created. Posting this handoff or a GitHub comment does not wake the Goal Controller.

Before another handoff, persist actual HEAD/run/job IDs, evidence, unresolved cause, authority limits and the next bounded action in this existing handoff and existing Issue/PR. Use non-force expected-HEAD updates where possible; reconcile races. Read back the saved content. This document's status is only its recorded checkpoint and must be replaced by live evidence at the next read.

Rollback only the new observation/document changes if required, while retaining failed CI runs, original code/evidence, owner Goal/Job history, rejected candidates and receipts. The complete preceding handoff remains preserved byte-for-byte in the archive. Keep PR1907 Draft and Issue1219 open until actual acceptance and applicable approvals.
