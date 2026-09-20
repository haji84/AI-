# NET-005 / NET-006 / NET-007 verification evidence

Issue: #885
Parent: #882 / #681
Evidence commit: `4040e22a61b1069213de5ee159a80cdf7846dc7e`
Evidence date: 2026-09-20 UTC

## Scope

This record covers only the software evidence classes required by NET-005, NET-006 and NET-007: CODE, UNIT, INTEGRATION and SECURITY. These requirements do not require PHYSICAL or RECOVERY evidence.

No device application version, enrollment, secret, credential, permission, firewall, billing, Human Gate, private-ingress policy or paid-route behavior is changed by this evidence record.

## CODE

PASS at `4040e22a61b1069213de5ee159a80cdf7846dc7e`.

Relevant implementation remains in:
- `src/app/owner-auth.ts`
- `src/app/api/jarvis/broker.ts`
- `src/jarvis/worker-auth.ts`
- `scripts/jarvis-broker.ts`

PR #886 added regression coverage without changing Production implementation code.

## UNIT

PASS on GitHub Actions CI run #1275 (`35512801434`) for exact main SHA `4040e22a61b1069213de5ee159a80cdf7846dc7e`.

The full Test step passed. Added coverage includes owner-session tamper/expiry/future-time/fresh-nonce behavior and worker request/result signature, tamper, clock and replay cases.

## INTEGRATION

PASS on GitHub Actions CI run #1275 for exact main SHA `4040e22a61b1069213de5ee159a80cdf7846dc7e`.

The broker regression confirms heartbeat, next-task and result routes remain behind worker authentication. The CI build and Production health checks also passed at the same SHA.

## SECURITY

PASS on GitHub Actions CI run #1275 for exact main SHA `4040e22a61b1069213de5ee159a80cdf7846dc7e`.

The dedicated `P8 Security Regression Suite` step passed after the full Test step. The added negative tests reject malformed/legacy/tampered/expired owner sessions, path/body signature tampering, stale/future worker requests and replayed nonces.

## Guardrails preserved

- Owner authentication remains fail-closed.
- Worker request/result signing remains required.
- Nonce/replay/clock protections remain enforced.
- No Human Gate is weakened or bypassed.
- No Production-facing physical behavior is claimed as verified.
- No independent-audit or AGI claim is made.

## Canonical-ledger follow-up

`docs/JARVIS_PRODUCT_SPEC.md` and `docs/jarvis-requirements.json` must be updated together so NET-005, NET-006 and NET-007 reference the same exact evidence commit and evidence classes. The mirror validator must pass before #885 is closed.
