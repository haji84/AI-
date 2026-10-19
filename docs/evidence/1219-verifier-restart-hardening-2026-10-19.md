# #1219 — Verifier executable boundary and interrupted Builder recovery

This increment repairs source defects on Draft #1827. It does not establish an authenticated AI-09 guest, a separate verifier principal, actual container checks or an OS reboot. No requirement is promoted to VERIFIED by this source work.

## Host executable boundary

The container helper excluded only its verifier working directory from Docker executable selection. The separate Builder candidate and exported source were missing from that boundary. An owner PATH containing a candidate-owned tools directory could therefore select a gitignored fake Docker executable under the signer host identity.

Independent reproduction on the previous source used actual detached temporary Git worktrees, a real fake CLI executable and an ephemeral test signer. The fake executable returned success for run/remove/list without creating a container. All six check labels became passed and a signed successful receipt was produced; the fake CLI ran 18 times. This demonstrates a host command-selection defect, not an actual Docker/container or production compromise.

The runner now passes candidate, verifier checkout and exported source as untrusted executable roots. The helper always includes cwd, resolves both roots and executable paths, and rejects a selected CLI inside any root, including directory-junction/symlink aliases. Invalid root configuration refuses before spawn. Rejection starts neither the CLI nor cleanup commands. A retained signed inconclusive diagnostic is permitted; no passed check can result from that rejection.

The new five regression cases failed on the previous source, including the false successful receipt. After the fix, the focused suite returned 26 PASS / 0 FAIL / 1 Windows-only unsupported case. Independent rerun of the real fake-CLI reproduction returned verified:false, one inconclusive lint result and zero CLI invocations. Scoped independent review found no unresolved P1/P2.

Trusted external executables/PATH, stable host metadata and effective OS permissions remain provisioning assumptions. These checks do not certify principal separation, actual Docker isolation or daemon cleanup.

## Interrupted Builder checkpoint

A second independently reproduced defect spans the new-file write and the later Change Set checkpoint. Discarding a successful Builder return before its checkpoint models that interruption: a fresh Builder retries the same RED or GREEN operation and rejects its own existing file as local_model_target_unsafe. Existing restart-at-verification-wait coverage did not exercise this window.

The sequenced host now supplies a prepared-write checkpoint through a direct trusted option, outside candidate workspaces. Its create-only, fsynced record binds the manifest contract, Goal, Job, Work Item, attempt, strategy, phase, base, workspace, target path, model and bounded public fixture bytes/hash. Neither Goal text nor model output can choose the journal location or recover another task. A prepared record remains `verified:false` and cannot satisfy a check or criterion.

Recovery reattests the exact base and complete allowed Git status, exact fixed `python_add_v1` bytes and existing RED test before reconstructing the Change Set. Interruption after intent but before creation permits only the intended `wx` new-file write. Interruption after creation reuses those exact bytes without inference, rewriting or deleting the file. Missing/mismatched intent, changed bytes, unrelated changes, symbolic-link/junction aliases and hardlinks refuse. The generic Builder's existing-file rejection remains unchanged. The single trusted host writer and protected external state directory remain prerequisites.

The prepared-write boundary suite passed all 12 cases. The host suite passed normal operation plus RED and GREEN Change Set checkpoint interruption, reconstructing the runtime, preserving the candidate and inference count, requiring signed fixture acceptance and completing the next declared Job. These are process/checkpoint simulations using fixture model/signature data. The first host invocation using the default Windows `py` failed all three Python checks; its log is retained. Selecting the already installed bundled Python explicitly passed all three, without installation. Independent RED/GREEN and signed receipt checks remain required after recovery. Actual OS power-loss and reboot acceptance remain open.

## Source verification

The focused source verification uses the existing Python interpreter selected by `GORIQ_LOCAL_TDD_PYTHON`; this does not provision a runtime or grant execution authority:

```text
node --test tests/local-prepared-write.test.ts tests/sequenced-resident-runtime.test.ts tests/runtime-local-ollama-builder.test.ts tests/resident-development-sequence.test.ts tests/verifier-container.test.mjs tests/independent-verifier-snapshot.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js <the ten changed source/test files>
git diff --check
```

The combined local run returned **64 PASS / 0 FAIL / 1 SKIP**, 65 cases total. TypeScript, the selected source/test ESLint check and `git diff --check` passed. The retained machine log is `../checks/source-hardening-final.log`. Independent review found no unresolved P1/P2 in the six recovery files or four executable-boundary files; cross-agent review is not a distinct GitHub account approval. Native observations if available, immutable source revisions and hosted CI links are recorded below and on Issue #1219 after execution. No anticipated hosted or physical result is asserted by these local checks.

## Rollback

Revert compatible Builder/checkpoint producer and consumer source together. Preserve all prepared records, Jobs, Change Sets, requests, receipts and native evidence. Never resume a checkpoint-bound candidate through older code that treats existing files differently. This increment neither provisions nor deploys a runtime, so no protected service, key, ACL, network or container change is required to undo its source.
