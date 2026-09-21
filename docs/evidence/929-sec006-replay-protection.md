# SEC-006 Replay protection evidence

Issue: #929
Parent: #882 / #681
Requirement: `SEC-006 Replay protection`

## Scope

This change closes the software gap identified after SEC-005: an accepted Worker nonce must remain rejected after Broker process restart for the remainder of its bounded replay window.

## Implementation

- `JarvisNonceRegistry` keeps the existing in-memory fast path and accepts a process-default persistence adapter.
- `JarvisSqliteStateStore` creates a strict `jarvis_worker_nonce` table keyed by `(node_id, nonce)` with an expiry timestamp and installs itself as the Broker process replay backend.
- Broker construction already creates `JarvisSqliteStateStore` before `JarvisNonceRegistry`, so the registry binds to the durable backend without changing Worker protocol, enrollment, credentials, permissions, ingress, or device software.
- Durable records are created only when the existing Broker authentication path has already passed identity, timestamp, nonce and signature verification.
- Expired replay records are deleted during registry checks/records, keeping the durable set bounded by the existing nonce TTL.
- Persistence failures propagate instead of silently accepting a protected request, preserving fail-closed behavior.

## Tests

`tests/jarvis-sec006-replay-protection.test.ts` verifies:

1. a valid signed Worker request is accepted once, recorded, the SQLite store is closed/reopened, and the same signed request is rejected as `worker nonce already used`;
2. replay state remains scoped per node;
3. durable replay state expires exactly at the TTL boundary and can be reused only after expiry;
4. Broker constructs durable state before its nonce registry;
5. Broker still verifies before recording and keeps Worker route handling behind replay protection.

`package.json` includes the focused test in `test:p8-security`.

## Evidence boundary

This is CODE / UNIT / INTEGRATION / SECURITY evidence only. It is not PHYSICAL evidence, not an independent internal audit, not a recovery acceptance result, and not an AGI claim.

Canonical requirement-ledger promotion remains separate if the safe large-file write path is unavailable.
