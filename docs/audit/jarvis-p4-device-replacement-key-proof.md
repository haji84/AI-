# P4 device replacement key-possession proof

Parent: #681
Child: #744
Requirement: FLEET-009 remains PARTIAL.

## Goal

Close a security gap in the software-only replacement preparation path without performing a privileged identity transition. Before a proposed replacement device can reach the owner Human Gate, it must prove possession of the private key corresponding to its proposed public identity.

## Implemented boundary

`JarvisDeviceReplacementCandidateManager` creates a one-time, in-memory challenge bound to:

- logical node ID
- replacement public-key fingerprint
- declared signing algorithm
- random candidate ID and random challenge
- absolute expiry, capped at 10 minutes

The replacement signs the exact versioned payload. Verification supports the existing worker algorithms (`ed25519` and `ecdsa-p256-sha256`) and fails closed for wrong signatures, wrong node IDs, expired/replayed candidate IDs, malformed/wrong-type keys, the currently enrolled key, and pending-capacity overflow.

A successful proof returns `READY_FOR_HUMAN_GATE`. It does **not** revoke the current identity, save the replacement identity, consume an owner approval, change credentials, or modify permissions. The actual old-key revocation/new-key binding remains an explicit credential/permission Human Gate.

## Privacy and persistence

The manager is bounded to at most 100 pending candidates and is memory-only. It stores only public-key material and challenge metadata. No private key, enrollment token, owner token, credential secret, or typed user content is persisted.

## Evidence class

This child provides CODE/UNIT/SECURITY preparation only. It is not PHYSICAL evidence and does not satisfy FLEET-009 by itself. Remaining work includes broker/worker transport integration, owner-facing approval transition, durable/audited identity mutation after explicit approval, rollback/recovery, and real-device replacement proof.
