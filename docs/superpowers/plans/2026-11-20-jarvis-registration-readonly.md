# JARVIS Registration Read-only Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline; one fresh final whole-branch review.

**Goal:** Determine whether JARVIS registrations survive outside the previous exact Goal/Job projection, without changing originals or authority.

**Architecture:** A separate owner/main-only action-free workflow uses the unchanged trusted capture and fixed staging leaves. A new copied-SQLite query and closed PowerShell parser expose counts and a derived Goal ID only.

**Tech Stack:** Node built-in SQLite, Windows PowerShell5.1, unchanged C# capture, GitHub Actions.

**Spec:** docs/superpowers/specs/2026-11-20-jarvis-registration-readonly-design.md

## Global Constraints

Keep the original five-target ACL repair and permanent477 claim untouched; its lifetime apply budget is exhausted. The diagnostic is read-only, owner haji84, main, runner21/ZBook, run-number1/attempt1, contents:read, no checkout/uses or new credentials. Require the latest matching CI, then recheck its identity/attempt and current main after source verification. Expiry2026-11-20T06:00:00Z, job5min, child40sec, query30sec, JSON1MiB, existing shared10000 JSON nodes/depth32, receipts500, WorkRuns2000. Combined bounds can reject otherwise valid large histories without truncation. Unknown metadata is null, not zero; no plaintext or actual Goal completion claim.

## Review Focus

- A valid empty Goal may still have unbound or non-target receipts.
- Duplicate keys/envelopes, malformed rows, unsupported version and bounds must fail closed.
- Live WAL content must be read only from disposable work while source/raw stay unchanged.
- A rerun, other triggering actor, wrong runner or stale source/CI cannot read user state.
- stdout, stderr and workflow outputs must not expose receipt statements, raw errors or local paths.

### Task 1: Deliver and execute the bounded metadata diagnostic

**Files:** Create scripts/goriq-jarvis-registration-read.mjs, scripts/goriq-jarvis-registration-read.ps1, scripts/goriq-owner-probe/test-jarvis-registration-read.ps1, tests/goriq-jarvis-registration-read.test.mjs, tests/goriq-jarvis-registration-workflow.test.mjs, .github/workflows/goriq-jarvis-registration-read-1219.yml. Modify only the inert Windows fixture invocation in .github/workflows/ci.yml and add state/evidence bookkeeping.

**Interfaces:** Node `inspectJarvisWorkingBundle(root)` returns a closed metadata summary; CLI accepts only the native capture root on supported Windows Node and writes the precreated interpretation file. PowerShell `Invoke-GoriqJarvisRegistrationRead(QuerySource, InventorySource, NativeSource)` returns one closed JSON string and uses unchanged imported capture helpers. `ConvertFrom-GoriqJarvisRegistrationSummary(Text, PreservedExpected)` validates canonical flat JSON and cross-field count relationships.

- [x] Write real SQLite receipt/WAL/privacy/failure tests, execute the first observable registration-count test and retain the expected missing-implementation RED.
- [x] Implement only the bounded working-copy reader; run all its fixture cases GREEN.
- [x] Write and execute PowerShell parser/adapter and real workflow-bootstrap rejection tests RED, then implement the adapter and separate pinned workflow and run GREEN.
- [x] Add the inert parser fixture to existing Windows PS5 checks; preserve all old commands/limits and old code bytes.
- [x] Run related124 PASS, full suite4540 total/4514 PASS/0 FAIL/26 existing skips, lint/typecheck and requirement audit626 surfaces/341 requirements; record evidence and commit.
- [x] Obtain one fresh-context final whole-branch review on the most capable available reviewer; resolve material findings with RED/GREEN and affected checks. Review found0Critical/5Important/1Minor; all five Important findings corrected, minor R5 deferred with rationale in evidence.
- [ ] Publish scoped PR, verify all four source CI jobs and fresh signed six-check audit, merge normally, then verify exact main CI and a new signed audit.
- [ ] Reserve the new independent read-only dispatch budget before POST, dispatch once, verify runner/job/log/closed report and native preservation, then update durable handoff and report actual findings. Never invoke the ACL repair again.

Expected local/hosted checks: zero new failures, no weakened/skipped existing assertions. Actual data outcomes may be positive or negative; INCOMPLETE never proves absence.
