# Real independent Verifier container CI implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the harness and a separately delegated image recipe; obtain independent review before the existing Draft PR is updated.

**Goal:** Execute the existing six fixed checks in real restricted containers on a disposable GitHub-hosted Linux runner and retain verifiable signed logs, without claiming physical AI-09 or ZBook acceptance.

**Architecture:** Assemble an image from digest-pinned official Node/PowerShell images, exact project manifests and the existing image-owned offline preparation helper. Use a temporary loopback registry only on the hosted runner to establish an actual repository digest. Call `runIndependentVerifier()` unchanged against two detached worktrees of the complete checkout, then audit its signed receipt and retained logs. A separate explicit CI entry point prevents recursive container tests in `pnpm test`.

**Tech Stack:** Node24.19.0, pnpm11.19.0, Docker, Ed25519, existing TypeScript receipt validation.

**Spec:** `docs/evidence/1219-offline-verifier-image-contract.md`, `docs/architecture/phase20-verifier-invariant.md`, Issue #1219 formal handoff6257803853.

## Global constraints

- Keep all six production commands and the180-second,2GiB,128-PID,1.5GiB tmpfs limits unchanged.
- Only disposable GitHub-hosted Linux execution may build images/start the local registry. Never install or activate containers, credentials, networking or startup changes on ZBook/AI09.
- No workflow permission, secret, deployment or merge-authority changes. No external image publication.
- Ephemeral test private key stays outside every container mount and uploaded artifact. Retain public key, receipt, six logs, exact source/image identities and cleanup evidence only.
- Full repository checks run; a missing tool, exceeded resource limit, failed check or unavailable Docker is a visible failure. Do not replace checks with fixture commands.
- Draft stack remains HOLD until separately approved actual physical independent verification and native E2E.

## Review focus

- Missing/tampered logs or mismatched image/source must not be accepted merely because the receipt signature is valid.
- A partial/failed six-check receipt must fail the CI outcome while retaining failure evidence.
- Hosted CI opt-in must fail closed locally and on self-hosted runners; ordinary `pnpm test` never starts Docker.
- Image assembly must admit exact manifests and working PowerShell/Git/Python/pnpm plus writable private HOME under/tmp without writable dependencies.
- Registry and check containers must be scoped to the current run and cleanup must be confirmed; no global Docker pruning or unrelated filesystem deletion.

### Task1: Signed real-container evidence audit

**Files:** Create `scripts/jarvis-verifier-live-ci.mjs`; test `tests/verifier-live-ci.test.mjs`.

- [x] Write real temporary-file/signature tests: valid six-log evidence, changed log, missing check, wrong image, unconfirmed cleanup, wrong binding/signature and non-hosted execution refusal.
- [x] Run `node --test tests/verifier-live-ci.test.mjs` and observe missing implementation failure.
- [x] Implement strict audit using existing signature/plan validation, fixed commands, actual log hashes and cleanup records; no Docker mocks establish live acceptance.
- [x] Run focused tests and lint.

### Task2: Disposable image and full six-check execution

**Files:** Create `tests/fixtures/verifier-image/Dockerfile`; complete `scripts/jarvis-verifier-live-ci.mjs`; modify `.github/workflows/ci.yml` with a normal test job and retained evidence artifact only.

- [x] Delegate image-only recipe with official registry digest lookup, manifest/helper-only build context, immutable installed dependency bundle and tool checks.
- [x] Add hosted guard, bounded real Docker build/local registry setup, actual repository-digest verification, full exact-source detached worktrees and scoped ephemeral signer.
- [x] Connect unchanged production runner and audit receipt/logs. Add a real isolated probe candidate checking UID, read-only source/root/dependencies, absent socket/keys/host environment and no external network capability. Actual execution remains pending CI.
- [x] Implement retention of failure logs as well as successful evidence and confirmation of owned-container removal. Keep private key and source export out of artifacts. Actual cleanup remains pending CI.
- [ ] Run focused tests, project tests, lint/typecheck and independent review before push; exact-head CI executes Docker.

### Task3: Evidence and handoff

**Files:** `docs/evidence/1219-offline-verifier-image-contract.md`, scoped evidence report and permitted state bookkeeping.

- [ ] Reconcile implementation surface manifest where required and record exact source/CI outcome, including any actual limit/tool failures.
- [ ] Update Issue #1219 and Compass with evidence and physical HOLD. No ready/merge/deploy from this CI-only result.
- [ ] Rollback is an exact reviewed source revert; no persistent device/container/key/network state is created by this change.

## Execution ledger

- Baseline08c9687997ffcd40ebaf989df98e0c85a46a6b93; maincb6b0fa06492b3d610ecb527645244b9a46ba8eb; existing untracked console-access proposal and caches excluded.
- Ruling: proceed with this ordinary implementation/CI plan under the owner's completion and critical-only confirmation instruction; no additional design-approval pause. Credential/permission/device changes remain separately gated.
- Ruling: execute the entire actual project rather than a small green fixture project, because the image contract requires complete exact-baseline checks. Resource failures remain failures.
- Ruling: outer live harness is an explicit CI command, outside `pnpm test`; no environment-based skip is needed inside verifier containers.
- Verification: audit/guard8PASS; related52-case run51PASS/0FAIL/1Windows POSIX-only SKIP with existing real Python pinned; lint/typecheck and600-surface/341-requirement auditPASS. Full default Windows suite2657PASS/32FAIL/1cancel/26SKIP explicitly retained, not called green.
- Review corrections: guard registry cleanup before its CLI launch; independent evidence-copy/registry/filesystem cleanup; replace ineffective pnpm env configuration with proved explicit options in image-owned wrapper. No runtime/check-limit or authority relaxation.
