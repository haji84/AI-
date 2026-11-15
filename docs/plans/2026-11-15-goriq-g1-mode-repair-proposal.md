# GORIQ G1 two-leaf permission repair proposal

## Scope and authority

Continue Issue #1219 for original Goal `goal-fcc81c97e09153f7` and Job `rotation-recovery-37`. Neither original is recreated, initialized or changed. The latest actual inventory, run `43687204876`, observed `NONPRIVATE_PERMISSIONS / ACTIVE_COMPASS` for exactly `owner-config-file` and `mac-canonical-repo-default`. Their current mode values, later path guards and contents are not known. Seven other Compass candidates and all nine Job/Change Set sidecars were missing in that bounded observation.

The owner's completion request authorizes this inert source preparation. It does not authorize an actual permission change. `AGENTS.md`, `evaluateRiskPolicy({ permissionChange: true })`, and `DelegatedApprovalPolicy` retain the separate Human Gate. Preparing reviewed candidate source and a draft PR is distinct from issuing permission or enabling an execution route.

Starting source: `a2c0daa45f080fbe04da6531066606c446606958`, Git tree `3cee5b368956aee47ca7b9ac50618c0e083732b0`. PR #1917 exact-head CI `43693233840` passed all four jobs and the existing six-check receipt audit. PR #1917 was protected-merged at 08:38:05 UTC as main `74c0b5fa40dc2249e482f26e904bdbb1d85fb842`, with the identical Git tree. Exact-main CI `43695429682` passed all four jobs and the existing six-check signature/binding/cleanup audit. This draft is based on that same tree and does not substitute for main CI.

## Reviewable preparation

Add only the inert algorithm and synthetic tests:

- `scripts/goriq-g1-compass-mode-repair.mjs`
- `tests/goriq-g1-compass-mode-repair.test.mjs`

The module performs no import-time I/O and has no CLI, native filesystem adapter, Broker hook, capability registration, workflow, package command, approval issuer or production trigger. Its operations and trusted approval boundary are injected by trusted code. This draft provides no connection to them. The tests use synthetic facts and operations, never a real owner's files.

## Required behavior

1. Plan only for the two observed labels; deduplicate the same identity without adding targets. Keep private path, identity, mode, owner, metadata and hash details private. Retain a frozen private proposal before returning its opaque handle so a future trusted Human Gate can review its exact binding before consumption. A proposal digest identifies a proposal; it is not approval and does not recreate the missing Goal contract.
2. Require regular files, the existing owner, one hard link, a nonempty bounded size at most 64 MiB, canonical path and parent safety, no aliases/symlinks, known safe ACL/flags and no special bits. Unknown or changing facts stop the operation.
3. Describe the real operation as `permissionChange`, HIGH risk, requiring specific human approval. Completion delegation, a JSON boolean, a copied object or a proposal digest cannot grant it.
4. Accept only a trusted, verified and consumed opaque permit bound to this proposal, source/artifact, host/owner, current facts and expiry. Enforce one use and refuse expired, replayed or mismatched authority before mutation.
5. Preserve owner permission bits and remove group/other bits only. Do not force mode 0600. Bind each operation to the same opened identity; preserve bytes, owner/group and device/inode, and retain a private baseline/journal before any mutation.
6. Recheck facts across asynchronous boundaries and before each side effect. Partial or uncertain completion is a recorded recovery condition, never a success or an excuse to repeat apply.
7. Roll back only this operation's mode on the same identity/owner, while the current mode still equals the mode this operation set. Do not overwrite subsequent owner changes, another inode or bytes. A failed rollback remains visible.
8. Return closed, non-sensitive status/reason/count output. Do not return private paths, raw exception messages, original bytes or private metadata/hash values.

WAL/SHM, directories, Broker DB, settings, keys, credentials, other candidates, ACL deletion, flags clearing, sudo, chown and service stop/restart are outside scope. Existing scanner checks, security policy, approval rules and CI limits remain unchanged.

## Verification and delivery

- First capture failing behavior tests, then implement the smallest candidate.
- Verify missing/forged/expired/reused/mismatched approval gives zero mutation; validate path/identity/metadata guards, two-target handling, owner-bit and byte preservation, asynchronous changes, partial failure, conditional rollback and closed output.
- Use an external 60-second bound with a five-second kill grace for focused tests.
- Independently review the final frozen source and its evidence. Run lint, typecheck, traceability checks and required CI on the exact published draft head without changing workflow/resource/time/concurrency/test gates.
- Publish a draft PR for concrete review. Do not merge or activate a privileged route without its applicable approval. Do not claim a production permission fix, original recovery or a ready-to-run host entry.

## Explicit remaining work after preparation

The real metadata/descriptor/private-journal adapter, trusted Human Gate connection, actual specific-action permit and owner-host apply entry are absent. Their correct binding and native descriptor lifetime/cleanup must be reviewed and authorized before use. In-process opaque handles are not a durable cross-process execution permit; uncertain recovery after process loss requires separately verified private journal evidence and current authority. Actual before-mode/identity facts remain unobserved; synthetic evidence cannot fill them in.

This candidate can be withdrawn without runtime rollback because it is unconnected and unexecuted. Actual future mode changes would use the separately approved, identity-bound mode-only rollback above. Original Goal acceptance remains NOT_ACHIEVED and Issue #1219 stays OPEN.

## Final local verification before publication

The original42 tests failed on the missing factory before implementation. Two scalar/identity defects and the missing pre-approval private proposal were reproduced and corrected. Independent review then reproduced an expiry race after the final awaited gate check in both apply and rollback. The final candidate performs a synchronous deadline check directly before each mode call, with no intervening await; apply checks before marking an attempt. The50-case regression file and the independent two-case reproduction now pass. Builder50/50 and independent50/50 overlap and are not added together.

Focused lint and typecheck passed after the final correction; earlier root full-repository lint and the626-surface/341-requirement audit also passed. The extra tests originally needed an explicit globalThis binding for queueMicrotask; that lint failure and correction are retained in the evidence. Source review has no unresolved findings. Exact published draft-head CI remains a separate gate. No actual permission or native operation occurred.
