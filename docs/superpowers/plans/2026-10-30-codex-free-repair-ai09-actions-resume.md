# Codex-Free Repair, Independent AI09 and Durable Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Keep this existing Goal #1219 and existing PRs #1824 / #1826 / #1827. Never create a replacement PR for a failed attempt.

**Goal:** An accepted LOW-risk development Goal continues safely from failed model output through changed-strategy repair, tests, independently signed AI09 acceptance, durable restart and the next Job without Codex dependency.

**Architecture:** Reuse the existing Goal Controller, DevelopmentJobStore, Change Sets, separate candidate worktrees, opt-in local Builder and independent verifier contract. New code is a capability increment, never an alternate Goal/PR scheduler. Release authority remains with existing Gate Controller. Untrusted local-model PASS is an advisory observation only.

**Tech Stack:** Node/TypeScript, existing resident orchestrator, local Ollama on ZBook, authenticated AI09, GitHub Actions, existing repository CI.

**Spec:** AGENTS.md / PROJECT_STATE.md / ROADMAP.md / Issue #1219 and the existing #1824 / #1826 / #1827 descriptions.

## Global Constraints
- No paid API fallback, new model download, quota overrun, secret read, credential/permission change, workflow/security relaxation, service activation or deployment without explicit scoped approval.
- Existing `main`, original worktrees, owner files and old evidence are immutable from the local Builder. Only one explicit new allowlisted file may be written in a fresh detached worktree.
- Rejection and correction stay under the same Goal, Work Item, and approved existing PR number. Retain failed receipts, strategy fingerprints, sources, test results, SHA bindings and timestamps.
- Corrected code must be re-tested and reviewed from its new SHA. Never reuse old PASS for changed code or an expired/different test contract.
- Protected release and high/critical Human Gates stay unchanged. No private key or credential value in logs.
- Source-only PR #1824 stays Draft/HOLD until exact-head CI, separate review, physical acceptance and protected gates all pass.

## Task 1: Failure-aware local Builder with bounded feedback

**Files:** `src/orchestrator/runtime-local-ollama-builder.ts`, `tests/runtime-local-ollama-builder.test.ts`, `docs/jarvis-reverse-traceability.json`.

**Inputs:** Existing `BuilderRequest.previousFailureSignatures`, `BuilderRequest.hypothesis`, `BuilderRequest.previousStrategyFingerprints` from `builder-router.ts`.
**Outputs:** A fresh, isolated candidate; no overwrite, release, commit or PR mutation.

- [x] Discover current data flow. BuilderRouter already forwards failure signatures and hypothesis, but original local Ollama prompt omitted them.
- [x] Add tests for a first isolated candidate followed by another isolated attempt with the same Goal and a new strategy; ensure both source files survive unchanged in their respective worktrees.
- [x] Add fail-closed validation: at most five distinct SHA-256 failure signatures, bounded non-control hypothesis, and hypothesis required for a retry informed by failed signatures.
- [x] Supply bounded feedback to the local prompt as *untrusted data*, not commands; do not widen its file or authority allowlists.
- [x] Keep a first-attempt hypothesis valid even when no earlier failure exists.
- [x] Reconcile the canonical source fingerprint without marking Goal achieved.
- [ ] Run a fresh exact-head full CI and independently inspect model-prompt handling and worktree safety. No green claim until observed.
- [ ] Obtain a real local Ollama response using an actual test-failed source under the same Goal, in a NEW owned detached worktree. Record before/after source SHA, prompts/response provenance and model identity in private evidence.

**Tests:** missing and duplicate digests, malformed feedback, overlong/terminal-control hypothesis, changed strategy, main checkout untouched, old candidate untouched, no Codex or remote endpoint, initial hypothesis regression. Negative tests must fail before candidate writes.

## Task 2: Genuine correction feedback and same-task state transition

**Files:** Existing `src/orchestrator/resident-development-goal-host.ts`, `src/orchestrator/development-job-store.ts`, `src/orchestrator/development-change-set-store.ts`, existing associated tests, and the PR #1826 scope-selection changes. Use a new helper only if the existing state controller cannot express the transition.

- [ ] RED: prove a failed implementation receives a persistent signature, is marked REJECTED, and that the next cycle under the SAME Job creates a genuinely changed strategy and another candidate without overwriting any existing candidate.
- [ ] Fix the existing transition IDs so each changed strategy/revision has an unambiguous idempotency key; test repeated restart of the exact same attempt has no extra Builder call.
- [ ] Build the next candidate in a new, clean, detached owner-approved worktree. Never delete/reuse a dirty prior worktree, and never infer extra files from user/model text.
- [ ] Bind failure evidence to the same Goal/Job/approved PR and exact prior artifact. A model's unsupported claim is not enough to establish a defect; require deterministic failure proof or a reproduced finding.
- [ ] Run trusted tests with the same evidence contract; reject unchanged source, unchanged strategy and stale review/CI artifacts.
- [ ] On partial crash, keep both original and correction evidence; on concurrent claims, enforce existing lease/fencing and stop safely. No implicit retry-until-PASS.
- [ ] Independently review, and keep PR Draft until signed acceptance.

**Review focus:** model repeats previous code; previous failure is hallucinated; owner edits same path; process crashes between state and output publication; two workers attempt the same candidate.

## Task 3: Formal independent AI09 acceptance, no signer substitution

**Files:** Existing stacked PR #1827 for the signed six-check verifier, `src/orchestrator/runtime-development-verifier.ts`, `src/orchestrator/runtime-ollama-review-checkpoint.mjs`, and `haji84/independent-ai09-reviewer` existing PR #2.

- [ ] Inventory exact-head source, reviewer identity, signer authority, fixed test-contract hashes and prior approved connector state. Do not re-enroll credentials or repeat an expired approval.
- [ ] Keep local `qwen3:4b` opinions separate as `LOCAL_OLLAMA_OBSERVATION`; no local PASS can satisfy `formalAI09ReviewExecuted`, signed-review or GitHub APPROVED.
- [ ] Connect to the existing separately rooted, authenticated signer and require source/artifact SHA, test suite/check contract, run identity, signer principal, timestamp and signature verification.
- [ ] Reject forged unsigned receipts, different source, model-only authority, stale evidence, missing logs and failed/inconclusive findings. Preserve originals.
- [ ] Physical private execution and DPAPI adapter work require current installation details and an exact new Human Gate when modifying key/VM/network/permission scope.
- [ ] Prove a genuine signed AI09 result for the actual repaired candidate, not only PUBLIC toy-model eight samples.

## Task 4: Distinct GitHub Actions execution restart and next Job

**Files:** Reuse `DevelopmentJobStore`, `Change Set` store, resident Goal Controller/Goal Bridge and existing approved Actions configuration. Any new workflow or permission change requires separately scoped approval.

- [ ] Freeze one bounded Goal, idempotency key, work item, PR, source base, artifact digest and approval scope; lock with existing owner contract.
- [ ] Run Actions execution A until a deliberate checkpoint between verification and next-Job dispatch; capture authenticated signed receipt and immutable durable store record.
- [ ] End A. In a distinct Actions execution B, load/verify the same original state and prove resumed next action with no duplicate Goal, PR or external side effect.
- [ ] Replay same idempotency key, stale source and conflicting concurrent-owner claims; reject duplicates and stale evidence.
- [ ] Disconnect/reconnect a local model; continue only with valid owner state and authorized capabilities.
- [ ] Prove explicit HOLD/HUMAN_REQUIRED for critical mutation, and resume only after an exact scoped, unexpired approval.

## Task 5: Physical end-to-end and merge gates

- [ ] On ZBook, with Codex unavailable, submit a bounded LOW-risk Goal through authenticated real entry point; confirm autonomous wake, model code, failed test, changed repair, independent signature, PR update, persistent restart and next Job.
- [ ] Ensure exact-head full CI success, independent source review, current base, protected rules and unchanged original worktrees.
- [ ] Only if all gates pass, request/execute allowed protected merge and verify the final main artifact and user operation.
- [ ] Never mark `endToEndVerified`, `actionsReplayVerified` or `mergeAuthorized` true from the current small smoke or GitHub-only mocks.

## Current evidence status, 2026-10-30

- Local owner smoke: real ZBook generation and 10/10 tests; separate-model review initially false-positive FAIL, then same frozen source was reviewed with PASS. This is NOT formal AI09.
- PR #1824: prior bound local receipt reuse and changed-source refusal had three relevant GitHub checks succeed on historical commit `47cb5a65`; full CI at that commit failed unrelated reverse-traceability checks later reconciled.
- New incremental Builder failure context and tests are committed on the existing #1824 branch, but **no latest-head Actions run was returned by the connected workflow-run query**. No full green or real-model correction result is asserted.
- PR #1827: signed six-check HOSTED_CONTAINER_CI evidence is not proof of Windows AI09 authenticated physical signer.
- Independent reviewer PR #2: PUBLIC 211/211 and eight toy responses are not private 8/104 actual review; DPAPI on-device adapter form remains an explicit block.
- All current PRs remain unmerged. Auth/permission, billing, deployment and other gates stay unchanged.

## Rollback and preservation

Rollback means reverting the scoped source/test/audit increment on the existing PR only after verification; never delete historical evidence, existing candidate directories or previous signed records. The approved owner project state remains unchanged and no new PR is created.
