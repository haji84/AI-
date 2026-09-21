# SEC-003 Signed Worker Request evidence

Issue: #920
Requirement: `SEC-003 Signed Worker Request`
Evidence classes: `CODE`, `UNIT`, `INTEGRATION`, `SECURITY`

## Implemented boundary

- Worker identity is resolved from the enrolled public-key record before a request can be accepted.
- The worker signature binds node ID, timestamp, nonce, HTTP method, request path, and SHA-256 body digest through `canonicalWorkerRequest`.
- The Broker derives method and path from the actual HTTP request and verifies the declared body digest against the actual request body before signature verification.
- Worker route dispatch occurs only after `authenticateWorker` succeeds.
- Both Ed25519 and the existing Android-compatible P-256 ECDSA verification paths remain supported.

## Focused verification

`tests/jarvis-sec003-signed-worker-request.test.ts` verifies:
- valid P-256 worker request acceptance;
- rejection after method, path, node ID, body-digest, signature, or enrolled-public-key tampering;
- Broker binding to actual HTTP method/path/body;
- authentication before Worker route handling.

The P8 Security Regression Suite also retains the broader `tests/jarvis-worker-auth-ecdsa.test.ts` coverage for signed heartbeat/results, clock skew, nonce replay, and route ordering.

## Evidence boundary

This is repository CODE / UNIT / INTEGRATION / SECURITY evidence. It is not PHYSICAL evidence, does not satisfy the independent P8 audit, and is not evidence for an AGI claim.
