# Owner observer bootstrap phases implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session.

**Goal:** Identify the actual bootstrap phase behind ZBook's current refusal.

**Architecture:** Retain the existing observation route and fixed C# bytes;
attribute exceptions to fixed child phases without emitting raw diagnostics.

**Tech Stack:** PowerShell5/C#5, existing Node fixtures and protected Actions CI.

**Spec:** `docs/superpowers/specs/2026-11-17-owner-bootstrap-phases-design.md`

## Global constraints

- Same Goal/Job, INCOMPLETE / recovered=false / G1 HOLD.
- No original content reads, acquisition, ownership/ACL repair or new authority.
- Preserve all source/CI/context gates, closed output and existing time limits.

## Review focus

- Exceptions from each module, signature, source/build/entry must not collapse.
- Invalid signature/workspace still refuses before compilation/entry.
- Exceptions, paths and additional output never cross the closed output boundary.
- Complete C# compilation must be exercised without invoking native observation.
- Hosted fixtures and successful dispatch do not establish owner facts.

### Task 1: closed phase attribution and executable boundary fixtures

**Files:** supervisor PS, dedicated bootstrap fixture, existing Node/PS fixture,
workflow source pin, diagnostic README, this design/plan.

- [ ] Add actual embedded-bootstrap fixtures with inert controlled boundaries;
  run RED for phase loss and verify the original generic refusal.
- [ ] Add fixed phase JSON replacements and preserve explicit context refusals.
- [ ] Add a real Windows supervised full-source compile with inert entry.
- [ ] Run focused/new and related tests, lint/types/requirements/surface checks;
  run the full suite and preserve every failure separately from baseline.
- [ ] Obtain one fresh review; fix material findings with reproducing tests.

### Task 2: protected integration and bounded actual observation

- [ ] Publish the scoped PR; verify exact-head and exact-main all-four CI.
- [ ] Audit independent source evidence without claiming physical acceptance.
- [ ] Rebind and dispatch one owner-only observation; validate actual job/source,
  runner identity and closed report before selecting any next recovery step.

Rollback is a normal protected revert of phase attribution and its fixtures;
there is no original/private-data mutation to reverse.
