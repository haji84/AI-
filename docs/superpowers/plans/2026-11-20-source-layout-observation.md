# Fixed Source Layout Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify known/unknown Source entries through one metadata-only observation without changing or replanning DACLs.

**Architecture:** One argument-free fixed-source PowerShell entry, pure enum projection, one pinned owner/main/manual workflow. Existing repair files and budgets stay unchanged.

**Tech Stack:** Windows PowerShell5.1, .NET metadata APIs, GitHub Actions, Node24 test runner.

**Spec:** docs/superpowers/specs/2026-11-20-source-layout-observation-design.md

## Global Constraints
- Fixed KnownFolder Source and self-development only;32 per branch,10sec,3min hardjob; deadline2026-11-20T06:00:00Z.
- Closed enum metadata, no raw names/paths/SIDs/content/exceptions; no original writes or claim/permission changes.
- Preserve existing repair plan1 consumed/apply0 and original frozen files; no plan replay.
- Owner/main/manual/current4CI, pinned source, runner21/ZBook/currentSID; fresh source-main4CI+signed6 before one diagnostic.

## Review Focus
- Filename/control-character/unknown-entry strings must never appear in output: Task1 projection fixtures.
- Reparse or nested directory must not be traversed: Task1 temp tree and boundary fixtures.
- Directory overflow or timeout must not masquerade as complete: Task1 bound/refusal tests.
- Expired or wrong actor/head/runner/source must stop before observation: Task1 inert workflow fixtures.
- A malformed report must not claim content read or permissions changed: Task1 closed-output tests.

### Task 1: One bounded observation capability

**Files:** Create scripts/goriq-source-layout-observer.ps1; scripts/goriq-owner-probe/test-source-layout-observer.ps1; tests/goriq-source-layout-observer.test.mjs; tests/goriq-source-layout-workflow.test.mjs; .github/workflows/goriq-source-layout-observation-1219.yml. Modify .github/workflows/ci.yml only to append lightweight PS5 fixture; PROJECT_STATE.md state prefix; add evidence JSON.

**Interfaces:** Get-GoriqSourceLayoutCategory(Location,Name,Directory) -> closed enum; ConvertTo-GoriqSourceLayoutReport(Rows) ->10key report; Read-GoriqSourceLayoutDirectory(Path,Location,Clock) -> metadata rows (internal only); Invoke-GoriqSourceLayoutObservation() -> one canonical JSON string, fixed production target/no caller path.

- [ ] Write real classification/report/temp-tree and operational-refusal tests, run RED against missing capability.
- [ ] Implement only metadata reader/projection/context and closed failure output; run GREEN.
- [ ] Write inert workflow behavior tests, run RED against missing workflow.
- [ ] Add pinned no-checkout owner/main/currentCI/runner guarded workflow and PS5 fixture step; run GREEN without changing old repair bytes.
- [ ] Run related tests, types/lint/audit and fresh full CI; retain every failure.
- [ ] Review whole branch in fresh context, resolve material findings, then normal protected integration and fresh exactmain4CI/signed6.
- [ ] Record distinct one-shot metadata budget, dispatch once, verify result; do not consume/replay original repair plan or apply.
