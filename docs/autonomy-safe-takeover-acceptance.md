# GORIQ safe unattended takeover acceptance contract

Status: implementation pending. This document does not authorize production activation.

## Source of truth
Compass owns Goal, work progress and checkpoints. Durable Task owns only execution claims. A checkpoint or lock file must never grant execution authority.

## Required implementation
1. Use one shared authoritative store accessible to trusted workers. Acquire, renew, expire and transfer leases with atomic compare-and-swap, monotonically increasing epochs and fencing tokens. Refuse execution when the shared authority is unreachable.
2. Validate the current fencing epoch within the same transactional boundary as each Compass progress mutation. If separate stores remain, do not allow protected success/progress writes.
3. Before any non-idempotent external effect, require a supported idempotency key or reconciliation protocol. Otherwise stop for explicit review; fencing a database write alone cannot undo external effects.
4. Keep each Goal stable across process restarts. Resume only from verified Compass state; preserve PAUSED, BLOCKED and approval_required gates.
5. A scheduler may reclaim only expired claims. Reconcile an interrupted action before retry, then execute on the new owner; the previous owner must be unable to commit progress.
6. Record owner, epoch, claim, checkpoint, recovery reason and evidence without credentials or secrets.

## Acceptance tests
- A worker begins a task and checkpoints progress.
- Force-kill the worker. A second worker reclaims after lease expiry and finishes without manual intervention.
- Simulate simultaneous claims; exactly one worker acquires each epoch.
- Restore the old worker and attempt a stale write; it must be rejected.
- Simulate lost shared-store connectivity, corrupt checkpoint and pending Human Gate; fail closed.
- Prove no duplicate non-idempotent side effects and no premature Goal completion.
- Pass targeted tests, full CI and a physical MacBook/ZBook failure-and-recovery E2E; retain run IDs and logs.

Do not mark unattended recovery complete until these tests are evidenced.