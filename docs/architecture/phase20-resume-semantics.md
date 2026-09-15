# Phase 20 resume semantics

The Phase 20 coordinator persists run identity, goal, state, cycle count, last Goal Loop report and verifier evidence atomically. A completed `runId` is idempotent across process restart and is returned without re-execution.

Waiting/approval/blocked runs remain durable records. Resuming their underlying task state is delegated to the already-existing durable/offline Goal Loop and task-runtime stores supplied by composition through `loopFactory`; Phase 20 does not duplicate their queue/lease/checkpoint policy.
