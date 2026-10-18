# GORIQ #1219: independent verifier and real ZBook Goal acceptance

Status: **software increment under Draft #1827; physical validation HOLD**. This is a procedure and acceptance contract, not evidence of having executed the procedure.

## Trust and permission boundary

The local Builder writes only to a fresh, explicitly pinned clean detached Worktree. The verifier must be a different owner-approved OS/VM principal; it must never use the 8796 or 8797 Builder endpoint as its verifier. Keep the private Ed25519 key in verifier-only storage, outside all Builder-accessible paths and the verifier's untrusted checkout. Owner provisioning of the private key, account/ACL or VM capability requires its separate Human Gate. **Setting `GORIQ_VERIFIER_OPERATOR_ISOLATED=1` alone does not establish separation.** Verify effective identity, file ACLs, container isolation and mounted paths independently first.

The new fixed-check runner `scripts/jarvis-independent-check-runner.mjs` refuses execution without an explicit trusted, locally installed `name@sha256:<digest>` container image. It uses `docker run --pull=never` with no network, read-only mounted verifier checkout, all Linux capabilities dropped, no-new-privileges, a nonroot UID, memory/CPU/PID limits and a bounded temporary filesystem. No arbitrary commands or online package installation are accepted from the Goal payload. Docker daemon security and kernel/container escape risk remain host concerns; they are **not** solved or certified by the JavaScript alone. The actual pinned image must contain matching Node/pnpm/toolchain, installed dependencies and needed build tools. Do not assume that Docker is available on ZBook or that a checked-in image exists.

## What the verifier genuinely does

Given an explicit manifest and a fresh separate verifier checkout at the exact same base revision:
1. Read back the Builder's one or more allowlisted new files, exact Git revision and SHA-256, rejecting dirty/changed paths.
2. Stage only those files into a clean separate verifier Worktree. Do not modify the owner primary checkout or previous smoke Worktree.
3. Execute **only** fixed lint / TypeScript / complete Node test suite (unit/integration) / P8 security / build checks in a preinstalled restricted container. Missing image, command or dependency yields no PASS. Check output hash includes command, arguments, exit status, stdout/stderr and tool failure code; no raw secrets are published in the receipt.
4. Re-read the original Builder artifact and verify the identical candidate before signing.
5. Produce a bounded, timestamped Ed25519 receipt with exact Goal ID, Job ID, Change Set ID, Builder ID, base/candidate revision, artifact digest and per-check outcome. Only a separately pinned public key allows the normal Goal Executor to consume it.
6. Keep missing or failed evidence distinct. Unsigned reports, labels, out-of-date results and missing platform-specific checks never authorize release.

A passing fixed suite is not an independent human code review, proof of absent vulnerabilities, native Windows/macOS/device verification, or permission to publish.

## Physical ZBook acceptance sequence (not yet executed)

**Phase 0, read-only inventory:** preserve original checkout and both existing untracked evidence files. Check current heads and `git worktree list --porcelain`; verify listener PIDs and health on 8787, 8796 and 8797 without altering them. Confirm installed Ollama model via local `/api/tags`. Confirm private verifier principal is unavailable to the Builder.

**Phase 1, authorized isolation:** after Human Gate for any required separate identity/key, prepare two *new* detached isolated worktrees (Builder candidate and verifier checkout) from an exact pinned commit, with clean baseline and distinct paths. Never reset, clean, delete or reuse the old smoke worktree. Preinstall the pinned no-network container image and dependencies under approved zero-additional-cost conditions. Set local model routing to the existing installed Ollama only; keep Codex and paid fallback explicitly unavailable.

**Phase 2, authenticated Goal:** spawn a new test Broker on an OS-assigned unused loopback port with its own temporary Compass DB, owner authentication and persisted Work Run. Do **not** restart or rebind the existing port 8787 Broker. Submit one deterministic LOW-risk Goal with explicit criteria and idempotency key, then repeat the same key and prove one Goal/Work Run. Do not substitute a GitHub Issue comment for actual intake.

**Phase 3, real execution:** observe Goal Controller waking the resident executor; retain Goal ID, Job ID, Change Set ID, exact model tag, base revision and file hash. Prove a real `11434/api/generate` call with installed local Ollama and zero Codex/remote model calls. Capture actual RED failing test evidence followed by changed file and passing GREEN test. Do not infer this from HTTP 202 alone.

**Phase 4, independent verification:** have the separate verifier principal read the candidate and execute all six required check classes in the restricted preinstalled container, publish signed receipts, and verify them using the previously pinned public key. Ensure data-binding matches source revision and artifact digest. A byte-readback-only or single Python unit proof cannot satisfy all six required checks.

**Phase 5, durability and continuation:** interrupt only the newly created *test* Broker/executor once after a persisted checkpoint, restart that test instance with the same database, then prove the Goal and Work Run IDs are unchanged, the Builder is not re-invoked for an already verified Change Set, no duplicate PR is opened, the next incomplete job is selected automatically and persisted Goal status advances. Preserve exact receipts and per-step evidence. Test recovery after a genuinely failed check and behavior at a Human Gate; do not bypass it.

**Phase 6, release decision:** require separate human independent PR review, protected head CI, correct base mergeability, release approval as applicable, and post-merge physical checks before `ACHIEVED`. Do not merge Draft #1824/#1826/#1827 or alter Vercel solely due to isolated success.

## Required evidence fields

- exact test Broker process identity and port, URL path (not bearer token)
- Goal ID, Work Run ID, Job ID, Change Set ID, idempotency key digest
- model/provider name and genuine local inference receipt, Codex-used boolean
- original/new Worktree paths and exact HEAD; changed path list and SHA-256
- RED error signature and exit status; GREEN exit status
- verifier principal/container image digest, public-key fingerprint, per-check status/log hashes, signed receipt file fingerprint
- process restart checkpoint and before/after Goal status, next autonomous action, duplicate suppression counts
- exact CI run/head, independent review outcome, Human Gate decisions

Treat missing, forged, stale, inconclusive or unavailable evidence as HOLD. **The current GitHub connector cannot access the ZBook loopback endpoints or carry out this physical test.** A GitHub CI PASS proves software tests, not the physical acceptance sequence.
