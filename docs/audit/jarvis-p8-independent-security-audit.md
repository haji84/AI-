# JARVIS P8 Independent Security Audit

Parent: #681
Implementation work item: #853

## Status

Independent audit status: **PENDING**.

This document is the handoff for the P8 exit gate. The person or automation that implemented the P8 regression-suite changes MUST NOT self-certify the independent audit as PASS. A PASS requires a reviewer who did not author the audited change to run the checks against the exact `main` commit being accepted and record the evidence below.

A software/CI PASS is not PHYSICAL evidence. This audit also does not establish AGI and is separate from Research R1-R20.

## Security invariants that must remain intact

The audit must fail if any acceptance path weakens these boundaries:

- owner authentication and bounded owner-session validation
- signed Worker request/result verification and registered device identity
- nonce/replay/timestamp protections
- private ingress by default; no public-ingress fallback
- per-device capability allowlists and owner-gated capability changes
- Human Gates for destructive, permission, billing, credential, secret and external-publication actions
- secret/token redaction and repository leak detection
- Remote Assist / Human Takeover audit trail and session controls
- privacy blackout without hiding safety warnings
- no-paid-default routing
- verifier/protection failure is fail-closed, not fail-open

## Reproducible commands

Run from a clean checkout of the exact `main` SHA under audit:

```bash
pnpm install --frozen-lockfile
pnpm test:p8-security
pnpm lint
pnpm test
pnpm build
```

Also inspect the GitHub CI result for the same commit and require both repository guard and project checks to complete successfully.

## P8 DoD evidence map

| P8 requirement | Direct regression evidence |
| --- | --- |
| Owner auth and session controls | `tests/owner-auth.test.ts` plus bounded/rotating session implementation from #847 |
| Signed Worker requests/results | `tests/jarvis-worker-auth-ecdsa.test.ts`, `tests/jarvis-worker-identity-store.test.ts` |
| Nonce/replay/clock protections | `tests/jarvis-p8-negative-security.test.ts` |
| Private ingress only | `tests/jarvis-private-worker-ingress.test.ts` |
| Capability allowlists / per-device permissions | `tests/jarvis-enrollment-security.test.ts`, `tests/task-authorization.test.ts` |
| Secrets not committed/logged | `tests/jarvis-secret-audit.test.mjs`, `docs/audit/jarvis-p8-secret-audit.md` |
| Human Takeover / Remote Assist audit trail | `tests/jarvis-remote-assist-audit.test.ts`, `tests/jarvis-remote-assist-session.test.ts` |
| Privacy blackout / sensitive panels | `tests/jarvis-display-modes.test.ts` |
| Destructive/permission/billing/credential gates | `tests/human-gate-shortcuts.test.ts`, `tests/secret-op-approval.test.ts`, `tests/task-authorization.test.ts`, `tests/no-paid-ai-runtime.test.ts` |
| Threat model and security regression suite | `tests/jarvis-p8-threat-model.test.mjs`, `pnpm test:p8-security`, this runbook |

## Independent audit checklist

Record PASS/FAIL for every item. Any unexplained FAIL makes the overall audit FAIL.

- [ ] Exact audited `main` SHA recorded.
- [ ] Auditor identity recorded and auditor did not author the audited P8 suite change.
- [ ] Clean install completed with the repository lockfile.
- [ ] `pnpm test:p8-security` PASS.
- [ ] `pnpm lint` PASS.
- [ ] Full `pnpm test` PASS.
- [ ] `pnpm build` PASS.
- [ ] Same-SHA GitHub CI repository guard PASS.
- [ ] Same-SHA GitHub CI project checks PASS.
- [ ] Owner auth/session behavior fails closed on missing/invalid/expired auth.
- [ ] Signed Worker input/results reject tampering, wrong identity, stale clock and replay.
- [ ] Private-ingress policy has no public fallback enabled by default.
- [ ] Capability and protected-action checks do not accept gesture/pointer/voice/task text as authorization.
- [ ] Secret scan/log guard passes without printing secret values.
- [ ] Remote Assist retains session timeout/audit boundaries.
- [ ] Privacy mode does not hide Human Gate or safety warning state.
- [ ] Paid/external execution remains disabled by default.
- [ ] Known limitations below were reviewed and remain accurately documented.

## Known limitations at handoff

1. Owner sessions are stateless signed sessions with bounded expiry and per-login rotation. They do **not** provide immediate server-side revocation of one individual live session without separate server-side session storage. This is the explicit evidence boundary from #847.
2. Repository, unit, integration and CI evidence do not prove real-device, real-network, reboot, power-loss, cellular-ingress or other PHYSICAL behavior. Those acceptance observations belong to the physical product gates and must not be inferred from this audit.
3. An independent reviewer has not yet executed this checklist. Until that happens, the P8 exit gate remains **PENDING**, regardless of implementation-agent CI results.
4. This product security audit is not evidence for an AGI claim. Research R1-R20 has its own independent exit conditions.

## Audit evidence record

Fill this section only when an independent reviewer actually executes the audit.

- Auditor: `PENDING`
- Relationship to implementation: `PENDING`
- Audit date/time: `PENDING`
- Audited main SHA: `PENDING`
- `pnpm test:p8-security`: `PENDING`
- `pnpm lint`: `PENDING`
- `pnpm test`: `PENDING`
- `pnpm build`: `PENDING`
- Same-SHA repository guard: `PENDING`
- Same-SHA project checks: `PENDING`
- Findings: `PENDING`
- Known limitations accepted: `PENDING`
- Overall independent result: `PENDING (PASS or FAIL only after execution)`

## Exit rule

P8 may be marked complete only when the named security suite passes for the accepted commit **and** this independent evidence record contains an actual reviewer-backed PASS with known limitations documented. The implementation agent MUST NOT convert `PENDING` to `PASS` on its own.
