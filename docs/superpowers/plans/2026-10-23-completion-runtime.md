# Completion runtime activation plan

> Use superpowers:executing-plans; retain existing security, verification and deployment gates.

**Goal:** Activate #1858 through the existing resident executor and accept its real WorkState/notification/evidence path without altering the locked Goal or device registrations.

**Architecture:** A host-pinned, bounded Work/Codex handoff selects the already merged CompletionSource. The initial resident adapter permits only existing context.inspect and independent local artifact verification. It preserves the complete reviewed evidence requirements, including unsupported physical/download conditions. No model API, new scheduler, database schema, executor permission or remote ingress. The handoff is not supplied through owner text/model context. Absent host settings preserve existing defaults; a configured mismatched Goal or malformed handoff fails visibly.

**Owner scope:** 2026-10-23 request explicitly includes normal-environment activation and operational acceptance. Ordinary code/integration/exact main-CI-passing deployment is authorized for Issue1858 until 2026-10-23T23:59:59+09:00. Privileged OS/ACL/credentials/scope changes remain separate gates. No generic Production workflow metadata that would activate unrelated Vercel/token-repair jobs.

## Observed baseline

- Protected main fcd9e0e6, previous feature PR1860 merged/CI PASS.
- ZBook named task JARVIS Remote Host is running. Broker8787 reports a49c458d; 40 registered,39 ready,0 running. Gateway8790 and Dashboard3000 healthy. Existing private Worker listener8792 retained.
- Current production Compass Goal is an already completed unchanged-text artifact task. Shared MCP Compass instead belongs to stopped #1845; do not modify it.
- Config/launcher are owner/SYSTEM protected; no credential values read or printed. Actual native process ExecutablePath is unavailable in this context. Do not stop processes without complete identity verification. Native activation may require a separately reviewed same-owner task-context helper or owner UAC.

## Tasks

- [x] Add RED tests for host-pinned handoff (Goal/runtime/hash/expiry/root checks), actual artifact verification, default compatibility and resident executor routing.
- [x] Implement a bounded handoff loader and select it in jarvis-goal-executor before the legacy inferred-development path; preserve existing registry and verifier. Unknown/expired/mutated handoff fails closed, no fallback to another provider.
- [x] Execute real Broker/Goal executor E2E with SQLite and file readback, restart, wrong artifact and altered handoff. Independent review found failed artifact checks being marked DONE; regression test reproduced it and the completion outcome now retains incomplete work.
- [ ] Reconcile traceability; final independent review, CI/protected merge/main CI.
- [ ] Prepare exact-release archive/config baseline and rollback, preserving existing credentials/DB/40 registrations. Bind activation to exact release and process identities. Ask only for required privileged operations with exact reviewed helper and risk, before execution.
- [ ] Perform read-only assessment of current production artifact without changing its Goal/terminal WorkRun or calling adapter.run to bypass the terminal guard. File bytes alone cannot prove download. Full production execution acceptance requires a separately agreed nonterminal task or legitimate owner intake; isolated execution tests do not supply that evidence.

## Risks / stop conditions

Production is older than main; release staging and rollback are required. Do not bulk-kill Node, bypass app control, change ACL/task identity, rotate credentials or invent native visibility. If no safely authorized native activation exists, keep staged artifacts and report the exact missing operation; do not claim operational completion. Existing completed Goal/outputs remain preserved. New Goal replacement is not part of this canary.
