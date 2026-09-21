# SEC-005 Nonce protection evidence

Issue: #927
Requirement: `SEC-005 Nonce protection`
Evidence classes: `CODE`, `UNIT`, `INTEGRATION`, `SECURITY`

## Implemented boundary

- `nonce` is part of `canonicalWorkerRequest`, so changing it after signing invalidates the Worker signature.
- `verifyWorkerRequest` checks the authenticated node ID plus nonce against the supplied seen-nonce predicate before accepting the request.
- `JarvisNonceRegistry` keys entries by authenticated node ID and nonce, keeping equal nonce strings on different enrolled nodes independent.
- Nonce entries have a bounded TTL and are removed at expiration.
- Broker Worker authentication verifies identity/signature/clock/nonce first, fails closed when verification fails, and records the nonce only after successful verification. Worker route parsing and handling occur after that authentication boundary.

## Focused verification

`tests/jarvis-sec005-nonce-protection.test.ts` verifies:
- nonce tampering breaks the Worker signature;
- a recorded same-node nonce is rejected;
- the same nonce string remains separately scoped for another node;
- TTL cleanup occurs at the expiry boundary;
- Broker source ordering keeps `nonces.record` after successful verification and before Worker route handling.

Existing negative-security coverage continues to exercise the broader clock/replay behavior.

## Known boundary

The current Broker nonce registry is in-memory. This evidence does not claim nonce history survives a Broker process restart and does not turn SEC-006 Replay protection into a restart-durable claim. Any stronger persistence requirement must be implemented and verified separately.

This is repository CODE / UNIT / INTEGRATION / SECURITY evidence. It is not PHYSICAL evidence, does not satisfy the independent P8 audit, and is not evidence for an AGI claim.
