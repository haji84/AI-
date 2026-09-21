# SEC-007 Clock/stale request protection evidence

Issue: #934
Parent: #882 / #681
Requirement: `SEC-007 Clock/stale request protection`

## Scope

SEC-007 already had a five-minute Worker timestamp freshness check in `verifyWorkerRequest`, but the canonical requirement remained PARTIAL without focused requirement-level evidence. This change adds explicit regression coverage without widening the accepted clock window or changing Worker protocol.

## Existing protection

- malformed timestamps are rejected before signature acceptance;
- signed Worker requests more than five minutes in the past or future are rejected;
- the exact configured skew boundary remains accepted, while the next millisecond is rejected;
- Broker binds `x-jarvis-timestamp` into the signed request;
- Broker records replay nonce state only after freshness/signature verification succeeds;
- Worker route handling remains behind authentication.

## Tests

`tests/jarvis-sec007-clock-stale-request.test.ts` verifies malformed timestamp rejection, stale/future rejection, exact skew boundary behavior, and Broker verify-before-record/dispatch ordering.

`package.json` includes the focused test in `test:p8-security`.

## Evidence boundary

This is CODE / UNIT / INTEGRATION / SECURITY evidence only. It is not PHYSICAL evidence, not an independent internal audit, not recovery acceptance, and not an AGI claim.

Canonical requirement-ledger promotion remains separate if the bounded safe large-file write path is unavailable.
