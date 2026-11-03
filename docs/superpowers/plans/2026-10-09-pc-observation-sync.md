# PC observation synchronization implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist signed, bounded PC task observations before connecting cross-PC execution ownership.

**Architecture:** A client reads an explicit task projection from its local Broker, signs it with its existing PC identity, persists it locally and sends it to the enrolled peer. Both peers store observations and conflicts in a separate SyncRepository. Received observations never mutate the executable queue.

**Tech Stack:** Node 24.19, TypeScript, existing Ed25519 PC transport, SyncRepository and file lease.

**Spec:** [Decision](../../decisions/2026-10-09-pc-observation-sync.md), Issue #1754, [distributed architecture](../../architecture/goriq-distributed-node-fabric.md).

## Constraints and review focus

- Only enrolled MacBook/ZBook #1662/#1219 Storage + Coordinator participation; no new permissions or credentials.
- One explicit PUBLIC file-digest task per exchange; no full history/errors or arbitrary execution commands.
- At most 64 KiB per observation request, 64 task bundles and 16 variants per bundle. Exhaustion fails visibly without dropping evidence.
- Duplicate/reversed delivery, equal-sequence forks, conflicting immutable inputs and same-epoch claims must preserve evidence. Normal sequential task progress must remain distinguishable.
- Serialize storage across adapter instances/processes; use a fresh repository after every operation so save failure cannot create a false successful retry.
- Signed peer attestation is not global ownership, independent verification or the historical Worker's original signature.
- Exact peer revision, source identity, task ID and response digest must bind the exchange. Revoked identities and replayed requests remain rejected.
- Keep production, installed identities, executable queues and Android state unchanged during software tests.

## Task 1: Durable observation adapter

Files: new `src/jarvis/pc-task-observation.ts` and `tests/jarvis-pc-task-observation.test.ts`; existing PC validation/runtime may expose a read-only projection helper.

- [x] Add failing tests for validation, source/task binding, duplicate/reverse delivery, persistent conflicts, capacity bounds, storage failure and concurrent writers.
- [x] Run the new test file and confirm the new behavior is absent.
- [x] Implement a bounded projection and validated task bundles backed by SyncRepository, with one locked durable write per accepted variant.
- [x] Confirm remote observations cannot write to DurableTaskStore or invoke election/execution.
- [x] Run adapter and existing PC durable-work tests.

## Task 2: Broker and signed client connection

Files: `scripts/jarvis-broker.ts`, `src/jarvis/private-pc-transport.ts`, new `src/jarvis/pc-observation-client.ts`, integration and transport tests.

Interfaces: POST `/api/jarvis/worker/pc/observation/export` accepts `{taskId, revision}` and returns an explicit validated projection. POST `/api/jarvis/worker/pc/observation/receive` accepts `{taskId, revision, sourceNodeId, observation}` and acknowledges task ID, observation digest, duplicate and conflict status. Both routes use existing signed worker authentication. The receiver binds the source to that authenticated node. Client export stays on loopback, peer receive stays on the validated private origin and verifies the existing signed response.

- [x] Add a failing two-Broker integration test with distinct fixture identities, databases and child home directories.
- [x] Connect export/receive after existing authentication and before generic worker handling; extend only the explicit private-PC route allowlist.
- [x] Exercise real TCP interruption, fresh-nonce resend and Broker restart. Verify durable observation/conflict retention and byte-identical executable stores. Reciprocal sync must detect divergent independent local queues on both peers, without seeding observation storage from the test.
- [x] Reject wrong identity/role/revision/task, modified signed body and replay without mutation.
- [x] Run the new integration plus existing private transport/bootstrap/reconnect tests, lint and typecheck.

## Task 3: Reconciliation and protected integration

Files: decision/evidence documents, `PROJECT_STATE.md` permitted fields, `docs/jarvis-reverse-traceability.json` affected surfaces only.

- [x] Record software evidence and the fresh native prerequisite blocker separately; preserve all physical acceptance gaps.
- [x] Refresh affected surface fingerprints and map new internal surfaces to existing migration/security requirements without upgrading requirement status.
- [x] Independent review of implementation and adversarial cases; fix verified blockers and rerun affected checks.
- [ ] Commit on the issue branch, create/attach PR, run protected CI and inspect all review requirements.
- [ ] Merge only within ordinary task authority after required checks; verify exact merged main CI. No production activation or fault injection under this increment.

Rollback retains observations and existing runtime state; source revert removes only this new adapter/route. The native #1662 ACL recurrence is a separate blocker and is not repaired by this plan.
