# Issue #1219 — 2026-10-19 source and ZBook observations

Status: **source increment; physical end-to-end acceptance HOLD**.

Baseline: main `cb6b0fa06492b3d610ecb527645244b9a46ba8eb`, Draft #1824 `c43700bac7c5ea4e4aa683c4d3fb80d2f0786e8f`, Draft #1826 `bbd55bff51bf804de5419ebe1822b91ce908690b`, Draft #1827 `570c9d9559394b62d1d865daae531d9d3211e6fa`. Work uses a new managed `goriq-1219-verifier` worktree, preserving the existing checkouts/artifacts. Final commit, CI and review evidence are recorded on Issue #1219 after publication; this document does not claim an anticipated CI result.

## Reproduced and corrected software defects

- Supporting-file changes previously retained the same candidate identity. A two-file regression failed before the shared identity fix; all identity producers now bind sorted complete path/hash manifests. Single-file compatibility remains.
- Staged verifier files were not checked after execution. Both candidate and staged copies are now re-attested. Independent regressions substitute support files during staging and execution.
- A parent directory junction could place a purported external key inside the verifier checkout. The regression previously reached key parsing; it now rejects the alias before loading key material. Bounded descriptor reads reject nonregular/changed/oversized input.
- Host `git status` could invoke repository callbacks. A harmless temporary fsmonitor marker demonstrated this before hardening. Safe queries suppress hooks/fsmonitor, reject executable filter configuration, discard inherited Git routing overrides, and preserve raw NUL-separated inventories.
- Whole-directory copying exposed ignored contents/Git metadata. A separate export includes only tracked baseline and declared files; key/log parent remains private. Unix umask and executable-bit behavior must pass Linux CI.
- Check logs were discarded and container lifetime depended on the Docker CLI. Logs now persist with signed exact-byte digests; named-container cleanup and successful absence observation are mandatory. Timeout, overflow, missing close, failed cleanup, remaining container and daemon-query failure use controlled subprocess doubles. **No actual container was run.**
- Completed Job A hid persisted unfinished Job B. Real JSON-store reconstruction tests now select B, avoid duplicate builds, and preserve BLOCKED/HUMAN_GATE. This does not prove autonomous decomposition of a new Job.
- The existing Windows `py` launcher populated a temporary candidate with a Python runtime during the initial TDD test, causing `TEST_MUTATED_WORKTREE`. That fixture was cleaned up by the test. Further runs disable launcher automatic installation and explicitly use the already bundled Python. No deliberate system/container installation was performed. The fixed fixture executes code-owned temporary bytes, not a mutable Builder pathname; a swap-at-execution regression proves this boundary with intercepted execution.

## Verification boundary

Targeted tests exercise actual temporary Git worktrees, persisted JSON stores, real bounded Python RED/GREEN, fixture Ed25519 signatures and fake container subprocess boundaries. Fixture signing keys are temporary test material, not provisioned runtime credentials. The existing full-suite CI remains the integration gate.

Initial native baseline: 12/13 selected tests passed; `goal-verifier-receipt-wake.test.ts` failed at Windows file-symlink creation with `EPERM`. That existing test was not disabled or weakened. Its real symlink coverage requires a capable CI environment. The new Unix umask test is platform-specific and is skipped on Windows; it is configured to run on Linux, with the CI result recorded separately.

## Bounded real Ollama execution on ZBook

At source commit `9c0427498366b7967e0a6d471d529209d246855a`, the standalone native Builder/Python smoke completed from `2026-10-19T02:07:31.216Z` to `2026-10-19T02:07:50.396Z`. A new scratch repository at fixture base `835006ff847a37bdb1a6d814eb97b5231affe563` and its separate detached candidate were used. This fixture base is not GORIQ main, and `1219-native-smoke` is a fixture identifier, not a Broker-accepted Goal.

The installed `qwen2.5-coder:3b` received one real `POST http://127.0.0.1:11434/api/generate` (HTTP 200, `02:07:37.375Z`–`02:07:47.025Z`). Actual Python observed RED exit 1, then GREEN exit 0 for `add_positive` and `add_zero`. Inference was not mocked; routing allowed only the existing local Ollama endpoints and used the explicitly selected existing bundled Python. This proves the bounded Builder/Python path only, not authenticated intake, six-check independent verification, an independent OS signer, Broker restart or next-Job physical continuation.

Preserved artifacts: `C:\Users\qq113\.codex\worktrees\goriq-1219-verifier\checks\native-ollama-20261019\` (candidate, scratch repository and `evidence.json`). Driver: adjacent `checks\run-native-ollama.mjs`.

The parent invocation explicitly set `GORIQ_LOCAL_TDD_PYTHON=C:\Users\qq113\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`. That interpreter selection is recorded in the execution transcript, not embedded in `evidence.json`; the raw evidence must not be treated as self-contained interpreter provenance.

| Evidence | SHA-256 |
| --- | --- |
| Exact `evidence.json` bytes | `cbd5311e0a487df430978a41f27087d56f336ad5964e805bcaa3ef75a6ba4bb7` |
| GREEN primary artifact | `ba1a531f581d2e6094e978ed6f7aca7a8d92eeb62c6e7ad73ee692f7f18bc772` |
| GREEN complete candidate identity | `0d96920a2e79d42223e38f6a57ef25c2e4743265605b85515ee13e9052c2068c` |

Public handoff: [Issue #1219 native smoke and initial CI failure](https://github.com/haji84/AI-/issues/1219#issuecomment-6258180807). The first full CI at this source commit had 2598 passing tests, 8 failures caused by unreconciled source traceability, and 5 skips. Reconciliation must preserve requirement statuses; subsequent exact-head CI is recorded separately on the Issue.

## Read-only physical observations

On ZBook/HAJI, the local executor observed listener PIDs 10068/33948/25144 on 8787/8796/8797 and PID12920 on 11434; subsequent inventory retained those same PIDs. Ollama `/api/tags` reported `qwen2.5-coder:3b` installed. The preflight found no Docker CLI on this execution PATH, no configured/available pinned verifier image, no matched verifier public-key fingerprint and no attested independent principal. This does not prove that no container runtime exists elsewhere or inside the VM.

No protected service restart, VM input, network setting, ACL/account change, production deployment or runtime credential provisioning was performed.

## Remaining acceptance gates

1. Owner-approved separate verifier identity/key and existing or approved offline container environment; demonstrate private-key inaccessibility from Builder and actual bounded cleanup.
2. Authenticated test Broker intake followed by actual installed Ollama inference and all required signed checks on the same Goal/Job/Change Set.
3. Restart only that new test Broker; preserve IDs/artifacts and prove next useful Job continuation. Criterion-specific acceptance and autonomous Job decomposition still need integration; release Human Gate remains enforced.
4. Exact-head CI, independent review and explicit Draft integration approval; post-merge acceptance before Goal completion.

Rollback: revert this source increment on its feature branch as one dependency-consistent change (identity producer/consumer changes together). Do not reset existing worktrees or delete evidence. Multi-file receipts produced with the old identity remain stale; rerun validation instead of relabeling them.
