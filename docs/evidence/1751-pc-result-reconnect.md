# PC result reconciliation after connection loss (#1751)

Parent: #681 / #1219. Baseline: b8178e825b8f43d3c366cabdcef54417d17b0031.

## Observed failure and correction
The real PC client writes, syncs and reads a public file, then signs its result. If the Broker persists that result but the response is lost, an exact-task retry previously returned idle. Both local and signed-peer paths reproduced this failure before the change.

The existing authenticated next-task endpoint now returns an optional completed record for an explicit task ID only to the currently authorized result-owning PC. It validates Goal, target, digest/bytes, epoch, provenance and completion history. This is a read: no new claim, history transition or lease reclamation. The client validates the record and returns reusedExistingExecution plus the original executionObservedAt. It does not report new filesystem execution. Existing result replay/stale-claim rejection is unchanged; no persisted format or permission changes.

## Reproducible integration
Run:
`node --test tests/jarvis-pc-durable-work.test.ts tests/jarvis-pc-reconnect-broker.test.ts tests/jarvis-pc-bootstrap.test.ts tests/jarvis-private-pc-transport.test.ts tests/jarvis-pc-peer-bootstrap.test.ts tests/gai-durable-task-runtime.test.ts tests/gai-durable-task-concurrency.test.ts`

On the ZBook development host, all 54 tests passed. Before implementation, both after-commit TCP-loss scenarios failed with idle instead of completed, and two new contract tests failed.

Four isolated integration cases execute the real Broker, signed Worker, filesystem capability and persistent stores. A loopback proxy actually closes the TCP connection before result forwarding or after the Broker response is read; both Broker and Worker processes are restarted. Each recovered result matches an independently computed digest. After-commit recovery performs zero additional capability executions/result POSTs and preserves the exact task/history/time with one completion. Before-commit recovery safely reexecutes this RESTARTABLE digest. Fixture identities/state and child home directories are isolated from installed PC state.

This is software integration evidence on one Windows host. The peer-response signature is real; the Tailnet HTTPS address is mapped to a loopback TCP fixture, so it proves neither real TLS/Tailscale nor physical MacBook/Internet/Wi-Fi failure.

## Native prerequisites and remaining scope
Fresh read-only ZBook health on 2026-10-08 still reported runtime a49c458d69a28c0266be8fcad5b26253e5ed8d75. Runner recovery did not align the Broker to current main. Preserve #1662 ACL recurrence/no-repeat boundary; no production fault injection or deployment was performed.

Production Broker PC work still uses a local durable store with no current Coordinator-lease integration or replicated task-state transport. Coordinator epoch tests transfer artifacts and are not production workload failover. The existing remote driver is scripts/goriq-pc-mobile-task.ts; reuse it once exact runtime, enrolled identity and authenticated route preconditions pass.

This increment does not persist uncommitted Worker outputs, provide an outbox, transfer Coordinator authority, replicate task state, resolve partitions, prove PINNED/SIDE_EFFECTING behavior or establish exactly-once execution. Historical result source revision was not stored; the returned sourceRevision identifies the current client/runtime, while executionObservedAt retains the original result time.

## Rollback
Revert only this source/test correction. Existing stored tasks and identities remain unchanged; old clients continue to see task:null. Removing reconciliation restores the uncertain-completion gap. Full CI and independent review are recorded on the PR.
