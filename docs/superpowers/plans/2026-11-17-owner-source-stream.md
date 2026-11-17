# Owner source-stream compatibility implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session.

**Goal:** Deliver the fixed public diagnostic source reliably across console encodings.
**Architecture:** BOM-aware owned input reader; existing source transfer and gates.
**Tech Stack:** WindowsPS5/.NET Framework, C#5, existing Node/PS fixtures.
**Spec:** `docs/superpowers/specs/2026-11-17-owner-source-stream-design.md`

## Global constraints

- Same65536-byte source bound, all time limits, schema/security/CI gates.
- Fixed C# unchanged; no original acquisition, contents or permission changes.
- No raw source/exception/identity in diagnostic output; G1 HOLD.

## Review focus

- Reader ownership must not consume/dispose unrelated console state.
- Unicode preambles and ASCII-compatible encodings must preserve exact source bytes.
- Empty/oversized/malformed/invalid UTF8 must refuse before compilation.
- Source phases cannot masquerade as target observations or expand command lines past Windows limits.
- Tests must remain inert, including the complete original C# compilation fixture.

### Task 1: stream reader, closed subcodes and executable regressions

- [ ] Add BOM frame to actual embedded-bootstrap fixture; observe rejection RED.
- [ ] Add owned BOM-aware reader, fixed source subcodes and source pin update.
- [ ] Test exact full-source roundtrip/invalid frames and inert real PS5 UTF8-BOM parent.
- [ ] Run related/full checks and one fresh review; reproduce/fix material findings.

### Task 2: verified delivery and actual observation

- [ ] Scoped PR, exact-source/full Windows/independent CI and protected merge.
- [ ] Exact merged-main all-four CI and artifact/source audit.
- [ ] One bounded owner-only native observation; validate source/runner/report.

Rollback is a protected source revert; no original/private data is mutated.
