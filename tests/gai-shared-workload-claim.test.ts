import assert from "node:assert/strict";
import test from "node:test";
import { claimSharedWorkload } from "../src/gai/shared-workload-claim.ts";
import { commitSharedWorkloadResult, type SharedWorkloadSnapshot } from "../src/gai/shared-workload-authority.ts";

const at = new Date("2026-10-11T00:00:00.000Z");
const coordinator = { clusterId: "goriq", coordinatorId: "mac", epoch: 2, fencingToken: "leader", leaseUntil: "2026-10-11T00:02:00.000Z" };
function initial(): SharedWorkloadSnapshot {
  return {
    version: 1, revision: 0,
    coordinator: { ...coordinator, issuedAt: at.toISOString(), updatedAt: at.toISOString() },
    tasks: { version: 1, savedAt: at.toISOString(), tasks: [{
      id: "task", idempotencyKey: "task", type: "test", payload: {},
      status: "queued", priority: "normal", requiredCapabilities: [],
      dependsOn: [], attempts: 0, maxAttempts: 3, migrationClass: "RESTARTABLE",
      executionEpoch: 0, createdAt: at.toISOString(), updatedAt: at.toISOString(), history: [],
    }] },
  };
}
class Store {
  state = initial();
  async load() { return structuredClone(this.state); }
  async compareAndSwap(revision: number, next: SharedWorkloadSnapshot) {
    if (revision !== this.state.revision) return false;
    this.state = structuredClone(next);
    return true;
  }
}
test("claim and completion share one authoritative revision sequence", async () => {
  const store = new Store();
  const leased = await claimSharedWorkload(store, coordinator, "task", "zbook", 30000, at);
  assert.equal(leased.task.status, "leased");
  assert.equal(leased.claim.owner, "zbook");
  assert.equal(store.state.revision, 1);
  const completed = await commitSharedWorkloadResult(store, coordinator, leased.claim, { ok: true }, new Date(at.getTime() + 1000));
  assert.equal(completed.status, "completed");
  assert.equal(store.state.revision, 2);
  await assert.rejects(() => commitSharedWorkloadResult(store, coordinator, leased.claim, {}, new Date(at.getTime() + 2000)), /STALE_WORKLOAD_CLAIM/);
});
test("stale coordinator cannot claim", async () => {
  const store = new Store();
  await assert.rejects(() => claimSharedWorkload(store, { ...coordinator, epoch: 1 }, "task", "zbook", 30000, at), /STALE_COORDINATOR_CLAIM/);
  assert.equal(store.state.revision, 0);
});
test("PINNED work never moves to another node", async () => {
  const store = new Store();
  store.state.tasks.tasks[0]!.migrationClass = "PINNED";
  store.state.tasks.tasks[0]!.pinnedNodeId = "mac";
  await assert.rejects(() => claimSharedWorkload(store, coordinator, "task", "zbook", 30000, at), /WORKLOAD_NOT_CLAIMABLE/);
  assert.equal(store.state.revision, 0);
});
test("CAS conflicts cannot claim a task", async () => {
  const store = new Store();
  store.compareAndSwap = async () => false;
  await assert.rejects(() => claimSharedWorkload(store, coordinator, "task", "zbook", 30000, at), /SHARED_AUTHORITY_WRITE_CONFLICT/);
  assert.equal(store.state.revision, 0);
});
