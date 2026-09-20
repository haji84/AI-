# SEC-002 Session Control evidence

Issue: #917
Requirement: `SEC-002 Session Control`
Evidence classes: `CODE`, `UNIT`, `INTEGRATION`, `SECURITY`

## Implemented boundary

- Owner sessions are signed, include a fresh nonce, and have a bounded maximum lifetime.
- Session verification fails closed for missing secrets, malformed/tampered tokens, expired tokens, excessive future clock skew, and a different signing secret.
- Owner login creates an `HttpOnly`, production-`Secure`, `SameSite=Strict`, path-scoped session cookie with the same bounded lifetime.
- Owner logout explicitly expires only the Owner session cookie using the same strict cookie boundary and `Cache-Control: no-store`.
- Owner-only Broker access continues to require a valid signed Owner session.

## Verification targets

- `tests/owner-auth.test.ts`
- `tests/jarvis-sec001-owner-auth-integration.test.ts`
- `tests/jarvis-sec002-session-control.test.ts`
- P8 Security Regression Suite
- repository lint, full tests, production build, and production health check

## Known limitation

The Owner session is stateless. Logout removes the browser cookie but does not provide durable server-side revocation of a token that was copied before logout. This change does not claim such revocation and does not add a credential store, database, secret, permission, or network-policy change.

## Evidence boundary

Repository and CI results are software evidence only. They are not PHYSICAL evidence, do not satisfy the independent P8 audit, and are not evidence for an AGI claim.
