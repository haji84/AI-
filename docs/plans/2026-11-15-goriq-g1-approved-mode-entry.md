# Approved two-leaf Compass recovery maintenance

## Authority and purpose

The owner explicitly approved the concrete proposal in this continuation chat with `許可` and `許可して進めて`. The approval was recorded at 2026-11-15 14:40:55 UTC (23:40:55 JST) in Issue1219 comment6890852588 and read back byte-for-byte. It covers only the observed `owner-config-file` and `mac-canonical-repo-default` Compass leaves on the existing Mac, their mode-only narrowing, the private baseline and conditional mode-only recovery, and the narrowly scoped native entry needed to perform it. Original Goal `goal-fcc81c97e09153f7` and Job `rotation-recovery-37` are linkage identifiers, not reconstructed contracts.

This is a specific owner-chat instruction relayed by the authorized task operator. A GitHub comment, JSON record or digest does not become a human signature or an independently issued original-Goal permit. The ordinary completion delegation is not used to authorize this permission change. The original Goal Controller and original state are not replaced or initialized.

## Baseline and scope

Main is `74c0b5fa40dc2249e482f26e904bdbb1d85fb842`; exact-main CI43695429682 passed all four jobs and the existing six-check signed receipt audit. Draft PR1918 at `32212deaed73030ecf45da90368a329cba880e71` contains the reviewed inert algorithm, 50 passing focused tests, and exact-head CI43696637223 all-four/six-check success. Those results are historical evidence, not evidence for newly changed source.

The actual inventory43687204876 ran on Mac runner22, `MacBook`, self-hosted/macOS/ARM64 and found the two leaves refused as NONPRIVATE_PERMISSIONS. Their current mode, identity, ACL/flags, contents and later path guards remain unknown. Nine Job/Change Set sidecars were missing in that bounded observation. No original recovery is inferred.

The effect preserves owner bits, UID/GID, bytes and device/inode; removes only group/other mode bits; deduplicates the same identity; and refuses unknown or changed conditions. WAL/SHM, directories, Broker databases, configuration, credentials, other candidates, ACL/flags changes, sudo/chown and service changes are excluded. Creating private operation records is part of the approved baseline; existing directory permissions are never repaired.

## Implementation

1. Extend the existing PR1918, without direct main commits or another Goal. Add a native adapter retaining descriptors, walking safe parents, inspecting native Darwin ACL/flags and canonical descriptor paths, preserving a private journal, and retaining an exclusive durable consumption record for this one approval.
2. Use the existing pure plan/apply/conditional-rollback module. Bind the actual private proposal to an opaque in-process gate capability issued only by the fixed approved recovery entry after source, CI, host and scope checks. JSON/model input cannot issue it. The durable claim is keyed by approval identity, not an easily renewed run/session identifier.
3. Add a dedicated `workflow_run` entry after successful main CI. It has only contents:read, no secrets or new token scope, no schedule/dispatch/arbitrary command input. The merge title selector `[GORIQ-G1-1219-APPROVED-20261115]` limits scheduling to this deliberate merge and is not authority by itself. A hosted preflight and the Mac entry independently require repository/actor, fixed PR1918 protected merge, exact current main, fixed CI workflow/run/attempt and four successful jobs. Bind the actual Mac job to observed runner22/MacBook. The existing CI job already runs and asserts its signed six-check audit before successful exit; artifact readback remains separately audited after delivery.
4. Use a fixed six-hour eligibility bound ending 2026-11-15 20:40:55 UTC as an implementation safety bound, not a claimed user-specified deadline. Within it, each private plan expires after at most30 minutes. One durable consumption, workflow attempt1, and PR1918 exact merge-commit binding prevent replay on subsequent unrelated changes.
5. Recheck authority and facts immediately before the descriptor-based mode syscall and verify afterward. `fchmod` binds the opened inode; the OS does not offer a transaction combining all metadata/content checks and chmod. Do not claim a kernel compare-and-swap for the entire tuple. Any detected drift or uncertain result remains HOLD/RECOVERY_REQUIRED; rollback requires the same identity and the exact mode this operation set.
6. After an applied repair, use the existing bounded read-only inspector on only the two fixed candidates. Report closed statuses/counts without private paths, UID, metadata/hash values, raw errors or DB bytes. Finding the Goal is not full authenticated recovery or production completion.

## Verification and release

Capture behavior-test failures before implementation. Exercise source/run/actor/host/expiry/replay refusal, native descriptor identity and mode-only effects, byte/owner preservation, journal durability, partial failure and conditional rollback. Use temporary fixtures only; do not touch owner files during tests. Independently review final code, run affected tests/lint/typecheck/traceability, then exact-head CI and protected merge, followed by exact-main CI and the bounded actual Mac operation. Preserve failures and all refusal reasons in the continuing handoff. No existing timeout, resource, concurrency or security gate is relaxed.

Source rollback reverts these additions through a PR. A native mode restoration is only the separately approved conditional descriptor-bound procedure; an unknown post-crash outcome is not blindly replayed. The private consumed record is retained. Keep Issue1219 OPEN and original Goal NOT_ACHIEVED until genuine original recovery, real AI repair, Actions-to-Actions resume, automatic next Job, and final artifact behavior are demonstrated.
