# Fixed private-owner observation implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Identify the currently failing fixed private-storage owner target on ZBook.

**Architecture:** Reuse the supplied metadata-only observer through a new false-default mode in the existing gated diagnostic workflow. Supply pinned sources in memory and supervise the existing WindowsPS5 child.

**Tech Stack:** PowerShell5, C#5, Node24 executable fixtures, existing Actions CI.

**Spec:** `docs/superpowers/specs/2026-11-17-private-owner-observation-design.md`

## Global constraints

- Same Goal/Job; G1 HOLD, recovered=false; no private target creation or content reads.
- No Capture/Acquire, ACL/owner/security changes, new credentials or runtime.
- Preserve exact-main/four-job CI/source-pin gates and unchanged existing tests/caps.
- Public output contains only the closed diagnostic schema; record historical limits.

## Review focus

- Mutually conflicting selectors must execute no native job.
- Stale main, incomplete/wrong-source CI, or corrupt source bytes must refuse before observation.
- Loading the supervisor is inert; source transfer must not rely on checkout or source-file writes.
- Malformed or extra output must be discarded without exposing paths/SIDs/exceptions.
- Current observation and compiler-child timeout must not imply historical proof or full descendant termination.

### Task 1: gated observation and executable regression coverage

**Files:** `scripts/goriq-owner-probe/{goriq-private-owner-probe.cs,observe-private-owner.ps1,test-owner-probe.ps1}`, `tests/goriq-private-owner-probe.test.mjs`, `.github/workflows/{goriq-pc-private-network-probe.yml,ci.yml}`.

- [ ] Add executable fixtures for mode selection, context/main/CI/pin/output refusals and in-memory supervisor source handling; observe missing-mode failures.
- [ ] Import supplied observer unchanged; adapt supervisor stdin transfer with bounded source and retain original pure tests.
- [ ] Add the exclusive owner mode to the existing workflow, with pinned public bytes, existing gates, and closed reserialization; include inert Windows supervisor fixtures in existing Windows5min CI.
- [ ] Run focused existing/new tests, lint, types, requirements/surface checks and the full suite; preserve all failures and distinguish baseline/environment failures.
- [ ] Commit and obtain one fresh source review; fix material findings with reproducing tests.

### Task 2: exact source verification and one native observation

- [ ] Publish the scoped branch/PR; verify actual exact-head CI including Windows fixture results.
- [ ] Use normal protected integration if eligible; verify new exact-main CI and independent evidence.
- [ ] Dispatch the fixed owner-observation selector once; fetch actual job output and validate bindings/schema.
- [ ] Report the actual target/reason, or the exact capability/gate blocker without fabricating a diagnosis. Keep original Goal unrecovered until original-state evidence exists.

Rollback is a normal protected revert of this diagnostic mode; no private data is mutated.
