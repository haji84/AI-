# SEC-004 Signed Result evidence

Issue: #925
Requirement: `SEC-004 Signed Result`
Evidence classes: `CODE`, `UNIT`, `INTEGRATION`, `SECURITY`

## Implemented boundary

- Task results and remote-assist results enter through `/api/jarvis/worker/*` and are rejected unless `authenticateWorker` validates the signed Worker request first.
- The result payload is not trusted as an unsigned application object. Its raw request bytes are SHA-256 hashed, and the signed canonical request binds enrolled node ID, timestamp, nonce, HTTP method, exact result path, and that body digest.
- JSON parsing and result application occur only after Worker authentication succeeds.
- Task completion/failure and remote-result completion use the authenticated `identity.nodeId`, preventing the result handler from substituting an unauthenticated node identity from the payload.
- Both Ed25519 and the existing Android-compatible P-256 ECDSA verification paths remain unchanged.

## Focused verification

`tests/jarvis-sec004-signed-result.test.ts` verifies:
- valid signed task-result and remote-result envelopes;
- rejection after result path, body digest, node ID, signature, or enrolled-public-key tampering;
- Broker authentication before result-body parsing and before either result route is applied;
- task and remote-result application remain bound to authenticated `identity.nodeId`.

The P8 Security Regression Suite also retains the broader Worker-authentication coverage for clock skew, nonce replay, actual-body digest checks, and Worker route ordering.

## Evidence boundary

This is repository CODE / UNIT / INTEGRATION / SECURITY evidence. It is not PHYSICAL evidence, does not satisfy the independent P8 audit, and is not evidence for an AGI claim.
