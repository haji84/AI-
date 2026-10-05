# #1662 Mac owner-secret initialization — owner-approved separate Human Gate

## Proven failure

Exact main `62ea23618448291d116ccf096a68cd180e8296d9` passed [main CI37322375961](https://github.com/haji84/AI-/actions/runs/37322375961) and [CI-triggered native Production Sync37322603080](https://github.com/haji84/AI-/actions/runs/37322603080). [Mac native repair37322842987](https://github.com/haji84/AI-/actions/runs/37322842987), job111806003047, reached owner-environment-read and owner-auth at 2026-10-05T14:12:47Z and failed with `OWNER_SESSION_SECRET_MISSING`. The protected file/path checks and existing owner-token predicate passed. Neither existing `JARVIS_OWNER_SECRET` nor `AI_COMPANY_OWNER_SECRET` was available from the existing owner environment. This is a confirmed missing prerequisite, not an ACL/network/key-enrollment diagnosis.

The run stopped before staging or dashboard/LaunchAgent/Serve mutation. It retained existing keys and state. Do not rerun an equivalent apply or weaken the authentication guard.

## Concrete owner-approved operation — native execution pending

Target only the existing owner MacBook logical Node `macbook`, as the same non-root owner, under #1219/#1662. The owner approved this exact operation in [receipt5996554289](https://github.com/haji84/AI-/issues/1662#issuecomment-5996554289), from 2026-10-05T14:29:25.689Z through 2026-10-06T14:29:25.689Z. Source/artifact guards, independent review and exact-main CI still gate execution.

1. Revalidate exact current main, successful main CI, owner context, protected existing environment and the absence of both session-secret alternatives. A concurrently appearing existing secret is preserved; no rotation, replacement or import.
2. Inside that Mac owner process, generate one cryptographically random 32-byte secret, encoded as 64 hexadecimal characters. Initialize only `JARVIS_OWNER_SECRET` in the existing protected `jarvis.env`. Never use the Broker owner token, Gateway token or Node private key as this value. No new account, OAuth consent or token-scope grant.
3. First retain an owner-private local backup of the original file and exact permission/owner/ACL metadata, plus a Goal-linked content-free baseline receipt. Do not upload the backup, environment, secret, secret digest or subprocess output to GitHub/Chat.
4. Stage a sibling temporary file; retain every original byte and append only the missing assignment. Require unchanged source bytes/metadata immediately before replacement. Preserve original effective protection, owner, mode and ACL; if preservation is not provable, fail before replacing the file. This approval does not permit chmod/ACL/firewall repair or security weakening.
5. Replace atomically, source the protected file inside a bounded captured owner-local child, verify the generated value is available and the retained token/policy/state-path values are unchanged, then emit booleans and fixed classifications only. Keep the value solely under the existing Mac owner storage boundary.
6. Continue the previously approved dashboard/private-HTTPS repair only while its separate approval5994510905 remains valid (expires2026-10-06T12:31:33.880Z). This new credential gate does not renew that approval or Windows approval.
7. Verify native own-endpoint health, source/identity/schema/Android38 preservation, then seek exact-revision Mac↔ZBook signed discovery and task evidence. Windows update still needs its own current authorization and same-owner UAC administrator capability. Actual offline/reconnect/coordinator-loss/resync/failover/rebalance acceptance remains required.

This existing secret is also the local dashboard passcode/session-signing secret: `src/app/api/owner-login/route.ts` uses `jarvisOwnerSecret()` for passcode comparison and `src/app/owner-auth.ts` uses it for HMAC sessions. No cross-device owner cookie is assumed valid and no login/auth policy is changed. An owner who needs the newly generated passcode must access it locally on their own Mac; it must never be requested in Chat or public logs.

## Verification and rollback obligations before native apply

The executable implementation remains subject to review and exact-main CI. Before activation, demonstrate real filesystem tests for absent/expired/wrong-scope approval, existing-secret no-op, protected backup and unchanged original bytes/metadata, concurrent edit rejection, verification failure recovery, retry/idempotency and public-output redaction. Independent review and protected exact-head CI/main CI must pass; artifact/source binding must match the real approval.

A failure may restore the original environment only while the current file is still exactly this operation's known after-image and metadata match. A concurrent change blocks restoration visibly. Preserve the backup and sanitized receipt; never overwrite unknown changes. Recover dashboard/private-route dependencies through the existing scoped recovery before reverting a credential consumed by a newly launched dashboard. Existing Broker/Gateway, Node keys, PC enrollment, Android38, database/schema and roles remain unchanged.

## Why a separate approval is necessary

[AGENTS.md](../../AGENTS.md) explicitly states: “Separate Human Gate approval remains required for secrets/credentials, permission or token-scope changes”. The [actual Mac approval5994510905](https://github.com/haji84/AI-/issues/1662#issuecomment-5994510905) excludes “new account/token/key/DB/schema” and preserves existing credentials. Ordinary completion/merge authority is not credential-creation authority.

Status: missing-prerequisite diagnosis **PASS**; separate credential gate **owner-approved**; executable credential repair **15 component fixtures PASS, independent review/CI pending, native not executed**; prior native dashboard repair **FAIL**; signed cross-device task and physical mobility acceptance **BLOCKED**. GORIQ and Stage C remain incomplete. Nubia remains explicitly owner-deferred. Compass write-back unavailable; repository and linked native receipts carry the continuation.


## Executable boundaries

The existing exact-source Mac workflow runs initialization only in its prepare phase and only on exact merged PR1716/current-main CI. Both unchanged dashboard gate and separate credential gate bind all six executable artifacts. Native source, registered host identity, roles, Android38/schema, Broker exact revision and absent dashboard/private route are checked before credential mutation. Existing environment is read in a captured child with inherited CI credentials excluded.

The core uses a protected backup and journal, fsynced files/directories, and an atomic file exchange through the system Python3/ctypes helper. Apple [XNU stdio.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/stdio.h) defines Darwin renamex_np/RENAME_SWAP; Linux renameat2 is used only for component verification on Linux. No ordinary-overwrite fallback or package installation is permitted. Missing system Python or unsupported atomic exchange fails visibly before accepting an initialized environment. Existing file owner/group/mode, zero ACL and zero file flags are required and preserved; no existing permission metadata is modified.

A durable pending marker is checked before reading/accepting any configured secret or staging. Crashes/ambiguous recovery retain that marker and private original/after-image identity evidence. A later run blocks rather than treating an unverified after-image as a new baseline. The marker clears only after verified completion or restoration. Reverse exchange rechecks the active and retired files after awaited dependency checks; a race at the syscall moves the unknown owner edit back when its inode can be proven, retaining pending evidence and reporting BLOCKED. No unbounded recovery loop or unknown-change deletion. This is safety handling, not proven real-device power-loss acceptance.
