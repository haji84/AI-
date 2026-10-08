# ZBook Watchdog Launcher Recovery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; owner explicitly requests routine work without further confirmation. Retain independent review before merge.

**Goal:** Recover the duplicated native VBS launcher and verify the existing watchdog rejoin without changing task authority.
**Architecture:** Publish complete UTF16LE launcher bytes atomically and skip identical output. Share only this file-writing primitive between the existing installer and watchdog. Restore only hash-bound malformed native content with retained backups; keep existing task XML exact.
**Tech Stack:** Windows PowerShell5.1, .NET file replacement, Windows Script Host, GitHub CI.
**Spec:** https://github.com/haji84/AI-/issues/1745

## Constraints and review focus
- No new credentials, enrollment, ACL, task registration, task principal/trigger or security-policy changes.
- Preserve original native bytes and Android38/runtime backups; #1662 ACL recurrence remains a separate blocker.
- Require reviewed exact-main CI and a bounded machine receipt before operational restoration.
- Missing target, locked target, concurrent publishers, unchanged content and Unicode/BOM behavior require fixtures.
- Do not attribute the observed duplication to a writer without evidence; CI does not establish physical recovery.

## Task 1: Complete, idempotent launcher publication
Files: new scripts/gai-zbook-launcher-file.ps1; existing scripts/gai-zbook-watchdog.ps1 and scripts/install-zbook-persistence.ps1; new tests/gai-zbook-launcher-file.test.ps1; existing Windows CI job.
Interface: Write-GaiLauncherFile([string]path,[string]content) returns no output; throws on publication failure and leaves existing bytes intact.
- [x] Reproduce duplicate VBS block syntax rejection with harmless WScript.Echo payload; require single-block exit0/exactly one output.
- [x] Verify RED for missing helper, then implement UTF16LE BOM complete-file atomic publication and byte-equivalent no-op.
- [x] Verify Unicode, unchanged timestamp, denied replacement preserving bytes and simultaneous publisher outcomes. Do not weaken real failures.
- [x] Wire helper into installer/watchdog; installer copies helper before watchdog. Keep generated command and task-registration behavior unchanged.
- [ ] Run focused existing contracts and Windows fixtures, diff check, independent review, PR CI, protected merge and exact-main CI.

## Task 2: Bounded native restoration and physical evidence
- [ ] Inspect installed watchdog hash/source and exact3task XML. Prepare host-local original backups and machine-readable task/revision/expiry receipt.
- [ ] Replace only the verified malformed VBS and reviewed writer files needed for publication, preserving ACLs and task XML; refuse any unexpected baseline.
- [ ] Observe existing periodic supervisor recovery; do not directly launch Listener and mislabel it watchdog recovery.
- [ ] Inspect existing node-loss37607612844 rejoin and finalVerifier; retain honest evidence limits and write back GitHub, PROJECT_STATE and Compass.

Rollback restores only changed launcher/writer bytes from preserved originals, with task XML/ACL unchanged. Never alter the separate production ACL to unblock this task.

## Discovered prerequisite: worker distribution authorization

The existing main-push persistence workflow installs on both PCs without waiting for CI or checking task/node authority. Add a fail-closed inline gate before either checkout, preserving existing completion grammar and token scopes and requiring explicit target-node metadata. Candidate decision: docs/decisions/2026-10-08-worker-persistence-authorization.md. This deployment-governance change needs one concrete owner approval after code, tests and independent review; ordinary repair does not need renewed approval. The #1745 recovery must not activate the general installers.
