# JARVIS P4 replacement proof transport — 2026-09-16

Parent: #681
Child: #756
Requirement: `FLEET-009` remains PARTIAL.

## Implemented software boundary

The existing key-possession candidate verifier from #744/#745 is now wrapped by `JarvisDeviceReplacementTransport` and connected to the Broker.

Owner-authenticated route:

- `POST /api/jarvis/admin/replacement/challenge` creates a challenge only when the target node already has a stored, non-revoked worker identity.
- `GET /api/jarvis/admin/replacement/ready` shows candidates that proved the replacement private key and reached `READY_FOR_HUMAN_GATE`.
- `POST /api/jarvis/admin/replacement/discard` removes a ready candidate without mutating the enrolled identity.

Candidate proof route:

- `POST /api/jarvis/replacement/prove` accepts only `candidateId`, `nodeId` and the signature over the versioned bounded challenge.
- The response is a proof summary. It does not echo owner-only public-key material and does not revoke or rebind an identity.

## Bounds

- challenge lifetime: at most 10 minutes
- invalid proof attempts: at most 5 per known candidate before fail-closed blocking
- pending candidates: bounded by the existing manager to at most 100
- ready-for-review candidates: at most 100
- ready-for-review lifetime: 10 minutes
- all challenge/review state: process memory only; Broker restart fails closed

## Human Gate preserved

This transport deliberately has no approve/commit/rebind/revoke endpoint. A successful proof only proves possession of the proposed replacement private key and creates a short-lived owner-review record.

The actual privileged transition remains separate:

1. explicit owner approval
2. revoke/retire old worker identity
3. bind the verified replacement public identity
4. record an audit event
5. verify reconnect/task execution
6. retain a rollback/recovery path

Those steps change credentials/permissions and are not authorized by this preparatory LOW/MEDIUM child issue.

## Evidence boundary

This is CODE/UNIT/SECURITY transport evidence. It is not physical replacement evidence and does not complete `FLEET-009`. A real old-device/new-device transition is still required after an explicit Human Gate before that requirement can be promoted.
