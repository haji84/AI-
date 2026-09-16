# P4 durable worker reconnect software evidence

Parent: #681
Child: #746
Requirements: FLEET-007 / FLEET-008 remain PARTIAL because both still require PHYSICAL evidence.

## What this pins

The focused integration test uses a real temporary SQLite database and an actual Ed25519 key pair. It writes the enrolled public identity, closes the JARVIS state store, reopens the same database, and proves that a fresh timestamp/nonce request signed by the same worker private key still verifies without minting or consuming any new enrollment credential.

The test also persists a revocation, reopens the state store, and verifies that a fresh correctly signed request is still rejected with `worker identity revoked`. This prevents a restart from silently resurrecting a revoked worker.

## Boundary

This is CODE/UNIT/INTEGRATION evidence for the durable credential layer only. It does not prove Android process auto-start, Wi-Fi recovery, physical reboot, Broker transport recovery, or a real device reconnect. Those PHYSICAL/RECOVERY gates remain open and must not be promoted from this test.
