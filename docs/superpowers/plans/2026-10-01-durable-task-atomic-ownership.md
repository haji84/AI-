# Durable task ownership repair — #1658

**Goal:** Prevent stale and concurrent runtime instances from overwriting durable execution ownership, as a prerequisite of the existing GORIQ completion Goal #1219.

**Architecture:** Preserve the existing v1 snapshot and task state machine. Each public Runtime operation executes in a fresh, private in-memory session. Intermediate session writes stay private; the final snapshot commits once using compare-and-swap against the exact loaded snapshot. Memory CAS is synchronous; JSON CAS reuses the existing bounded local-filesystem cognitive writer lock. Conflicts fail visibly and require the caller to reevaluate current state. No cross-host consensus is claimed.

**Tech stack:** TypeScript, Node 24, node:test, existing JSON store and cognitive lease.

**Spec:** `docs/architecture/goriq-distributed-node-fabric.md`, existing DurableTaskRuntime contracts, #1658. Migration classes, task statuses, idempotency, execution epochs, fencing tokens, offline publication and dependency semantics remain unchanged.

**Constraints:** No production DB/schema/configuration, trust/key, credential, network/listener or permission changes. Nubia remains owner-deferred. Code/test/PR/merge/exact-main deployment authorization expires 2026-10-02T10:15:08Z. Stage C and the parent Goal stay incomplete until required live E2E passes.

**Baseline / rollback:** main ee9dbcb121a805032eb56267f0777f339f0ac1aa; code snapshot format remains v1. Revert the task PR and redeploy the exact successful revision; no state migration or deletion. Preserve earlier coordinator and inventory Evidence.

## Implementation

1. Add `tests/gai-durable-task-concurrency.test.ts`: memory/JSON independent-runtime takeover rejects all claimed mutations; concurrent leases and enqueue cannot overwrite each other; a delayed old operation cannot commit after takeover; non-atomic stores fail closed; same-instance concurrent calls use isolated state. Observe RED on baseline.
2. In `src/gai/durable-task-runtime.ts`, add optional `compareAndSwap(expected, next)` to the store contract and atomic implementations to built-in stores. Separate unchanged transition logic into a private operation session; retain public method signatures through explicit forwarding methods and a single fresh-snapshot/CAS transaction helper. Read-only calls require no CAS. Do not retry automatically or publish a result before commit.
3. Run concurrency tests, durable/offline/self-healing suites, then full tests, lint, TypeScript and build. Investigate every failure rather than weakening assertions.
4. Independent review focuses on operation isolation, nested transition persistence, CAS race windows, legacy snapshot compatibility and bounded lock behavior. Protected PR and successful exact main CI precede any ordinary authorized production refresh.
5. Write back machine Evidence to #1658 and #1219. Continue production composition; this repair alone is not live failover/rebalance acceptance.
