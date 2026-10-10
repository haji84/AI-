import assert from "node:assert/strict";
import test from "node:test";
import { commitSharedWorkloadResult, type SharedWorkloadAuthorityStore, type SharedWorkloadSnapshot } from "../src/gai/shared-workload-authority.ts";

const now = new Date("2026-10-11T00:00:01.000Z");
const lease = { clusterId: "goriq", coordinatorId: "mac", epoch: 3, fencingToken: "leader-3", leaseUntil: "2026-10-11T00:02:00.000Z", issuedAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" };
const claim = { taskId: "task-1", owner: "zbook", epoch: 5, fencingToken: "task-5", leaseUntil: "2026-10-11T00:02:00.000Z" };

function fixture(): SharedWorkloadSnapshot {
  return {
    version: 1, coordinator: structuredClone(lease), revision: 0,
    tasks: { version: 1, savedAt: now.toISOString(), tasks: [{
      id: "task-1", idempotencyKey: "task-1", type: "test", payload: {}, status: "running",
      priority: "normal", requiredCapabilities: [], dependsOn: [], attempts: 1, maxAttempts: 3,
      migrationClass: "RESTARTABLE", executionEpoch: 5, leaseOwner: "zbook",
      leaseUntil: claim.leaseUntil, fencingToken: claim.fencingToken,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), history: [],
    }] },
  };
}

class TestStore implements SharedWorkloadAuthorityStore {
  state = fixture();
  async load() { return structuredClone(this.state); }
  async compareAndSwap(revision: number, next: SharedWorkloadSnapshot) {
    if (revision !== this.state.revision) return false;
    this.state = structuredClone(next);
    return true;
  }
}

test("same authority commits exactly once", async () => {
  const store = new TestStore();
  const result = await commitSharedWorkloadResult(store, lease, claim, { ok: true }, now);
  assert.equal(result.status, "completed");
  assert.equal(store.state.revision, 1);
  assert.equal(result.leaseOwner, undefined);
  await assert.rejects(() => commitSharedWorkloadResult(store, lease, claim, { ok: true }, now), /STALE_WORKLOAD_CLAIM/);
});

test("stale coordinator and stale worker cannot commit", async () => {
  const store = new TestStore();
  await assert.rejects(() => commitSharedWorkloadResult(store, { ...lease, epoch: 2 }, claim, {}, now), /STALE_COORDINATOR_CLAIM/);
  await assert.rejects(() => commitSharedWorkloadResult(store, lease, { ...claim, epoch: 4 }, {}, now), /STALE_WORKLOAD_CLAIM/);
  assert.equal(store.state.revision, 0);
});

test("expired coordinator fails closed", async () => {
  const store = new TestStore();
  await assert.rejects(() => commitSharedWorkloadResult(store, lease, claim, {}, new Date("2026-10-11T00:03:00.000Z")), /STALE_COORDINATOR_CLAIM/);
});

test("CAS conflicts do not fabricate completion", async () => {
  const store = new TestStore();
  store.compareAndSwap = async () => false;
  await assert.rejects(() => commitSharedWorkloadResult(store, lease, claim, {}, now), /SHARED_AUTHORITY_WRITE_CONFLICT/);
  assert.equal(store.state.revision, 0);
});
