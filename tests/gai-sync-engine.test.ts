import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  JsonFileSyncStore,
  MemorySyncStore,
  SyncEngine,
  SyncRepository,
  compareClocks,
  resolveSyncRecords,
  type SyncRecord,
} from "../src/gai/sync-engine.ts";

function record(input: Partial<SyncRecord> & Pick<SyncRecord, "recordId" | "entityType" | "deviceId" | "clock" | "value">): SyncRecord {
  return {
    version: 1,
    updatedAt: "2026-09-15T00:00:00.000Z",
    syncState: "pending-push",
    ...input,
  };
}

test("causal clock comparison is independent of wall-clock timestamps", () => {
  assert.equal(compareClocks({ zbook: 2 }, { zbook: 1 }), "local-dominates");
  assert.equal(compareClocks({ zbook: 1 }, { zbook: 2 }), "remote-dominates");
  assert.equal(compareClocks({ zbook: 1 }, { macbook: 1 }), "concurrent");
  assert.equal(compareClocks({ zbook: 1, macbook: 2 }, { zbook: 1, macbook: 2 }), "equal");
});

test("causally newer record wins even when its timestamp is older", () => {
  const local = record({
    recordId: "task-1",
    entityType: "task",
    deviceId: "zbook",
    clock: { zbook: 2 },
    updatedAt: "2026-09-15T00:00:00.000Z",
    value: { status: "running" },
  });
  const remote = record({
    recordId: "task-1",
    entityType: "task",
    deviceId: "zbook",
    clock: { zbook: 1 },
    updatedAt: "2026-09-15T01:00:00.000Z",
    value: { status: "queued" },
  });
  const decision = resolveSyncRecords(local, remote);
  assert.equal(decision.kind, "local");
  assert.deepEqual(decision.record?.value, { status: "running" });
});

test("verified completed task outranks concurrent unverified task state", () => {
  const local = record({
    recordId: "task-verified",
    entityType: "task",
    deviceId: "zbook",
    clock: { zbook: 2 },
    ownerTaskId: "goal-a",
    verification: { status: "pass", verifierId: "verifier" },
    value: { status: "completed", result: "done" },
  });
  const remote = record({
    recordId: "task-verified",
    entityType: "task",
    deviceId: "macbook",
    clock: { macbook: 3 },
    ownerTaskId: "goal-a",
    verification: { status: "unverified" },
    value: { status: "running" },
  });
  const decision = resolveSyncRecords(local, remote);
  assert.equal(decision.kind, "local");
  assert.match(decision.reason, /verified completed task/);
});

test("concurrent incompatible critical state becomes explicit conflict", () => {
  const local = record({
    recordId: "goal-1",
    entityType: "goal",
    deviceId: "zbook",
    clock: { zbook: 1 },
    value: { target: "A" },
  });
  const remote = record({
    recordId: "goal-1",
    entityType: "goal",
    deviceId: "macbook",
    clock: { macbook: 1 },
    value: { target: "B" },
  });
  const decision = resolveSyncRecords(local, remote);
  assert.equal(decision.kind, "conflict");
  assert.equal(decision.conflict?.local.syncState, "conflicted");
  assert.equal(decision.conflict?.remote.syncState, "conflicted");
});

test("same task ownership can resolve concurrent state by stronger verifier evidence", () => {
  const local = record({
    recordId: "result-1",
    entityType: "result",
    deviceId: "zbook",
    clock: { zbook: 1 },
    ownerTaskId: "task-a",
    verification: { status: "pass" },
    value: { summary: "verified" },
  });
  const remote = record({
    recordId: "result-1",
    entityType: "result",
    deviceId: "macbook",
    clock: { macbook: 1 },
    ownerTaskId: "task-a",
    verification: { status: "unverified" },
    value: { summary: "draft" },
  });
  const decision = resolveSyncRecords(local, remote);
  assert.equal(decision.kind, "local");
  assert.match(decision.reason, /stronger verifier evidence/);
});

test("offline local mutation pushes and converges after sync", async () => {
  const local = new SyncRepository(new MemorySyncStore());
  const remote = new SyncRepository(new MemorySyncStore());
  await local.mutate({
    recordId: "memory-1",
    entityType: "memory",
    deviceId: "iphone",
    value: { observation: "offline note" },
  });

  const report = await new SyncEngine(local, remote).synchronize();
  assert.deepEqual(report.pushed, ["memory-1"]);
  assert.equal((await local.get("memory-1"))?.syncState, "synced");
  assert.deepEqual((await remote.get("memory-1"))?.value, { observation: "offline note" });
});

test("causally resolved record converges in both stores", async () => {
  const local = new SyncRepository(new MemorySyncStore());
  const remote = new SyncRepository(new MemorySyncStore());
  await local.put(record({
    recordId: "skill-1",
    entityType: "skill",
    deviceId: "zbook",
    version: 2,
    clock: { zbook: 2 },
    value: { score: 0.9 },
  }));
  await remote.put(record({
    recordId: "skill-1",
    entityType: "skill",
    deviceId: "zbook",
    version: 1,
    clock: { zbook: 1 },
    value: { score: 0.5 },
  }));

  const report = await new SyncEngine(local, remote).synchronize();
  assert.deepEqual(report.converged, ["skill-1"]);
  assert.deepEqual((await local.get("skill-1"))?.value, { score: 0.9 });
  assert.deepEqual((await remote.get("skill-1"))?.value, { score: 0.9 });
  assert.equal((await remote.get("skill-1"))?.syncState, "synced");
});

test("unresolved conflict is preserved in both stores instead of overwriting", async () => {
  const local = new SyncRepository(new MemorySyncStore());
  const remote = new SyncRepository(new MemorySyncStore());
  await local.put(record({
    recordId: "goal-conflict",
    entityType: "goal",
    deviceId: "zbook",
    clock: { zbook: 1 },
    value: { goal: "A" },
  }));
  await remote.put(record({
    recordId: "goal-conflict",
    entityType: "goal",
    deviceId: "macbook",
    clock: { macbook: 1 },
    value: { goal: "B" },
  }));

  const report = await new SyncEngine(local, remote).synchronize();
  assert.equal(report.conflicts.length, 1);
  assert.equal((await local.get("goal-conflict"))?.syncState, "conflicted");
  assert.equal((await remote.get("goal-conflict"))?.syncState, "conflicted");
  assert.deepEqual((await local.get("goal-conflict"))?.value, { goal: "A" });
  assert.deepEqual((await remote.get("goal-conflict"))?.value, { goal: "B" });
});

test("sync repository survives JSON store restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gai-sync-"));
  const file = join(dir, "sync.json");
  try {
    const first = new SyncRepository(new JsonFileSyncStore(file));
    await first.mutate({
      recordId: "evidence-1",
      entityType: "evidence",
      deviceId: "iphone",
      verification: { status: "pass", verifierId: "local-verifier" },
      value: { ok: true },
    });

    const second = new SyncRepository(new JsonFileSyncStore(file));
    await second.initialize();
    const restored = await second.get("evidence-1");
    assert.equal(restored?.deviceId, "iphone");
    assert.equal(restored?.clock.iphone, 1);
    assert.equal(restored?.syncState, "pending-push");
    assert.equal(restored?.verification?.status, "pass");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sync engine delegates concurrent development Change Sets to a verified resolver", async () => {
  const local = new SyncRepository(new MemorySyncStore());
  const remote = new SyncRepository(new MemorySyncStore());
  await local.put(record({ recordId: "change-conflict", entityType: "change-set", deviceId: "zbook", clock: { zbook: 1 }, value: { patch: "left" } }));
  await remote.put(record({ recordId: "change-conflict", entityType: "change-set", deviceId: "macbook", clock: { macbook: 1 }, value: { patch: "right" } }));
  const engine = new SyncEngine(local, remote, {
    async resolve(conflict) {
      assert.equal(conflict.entityType, "change-set");
      return {
        ...conflict.local,
        deviceId: "goriq-integrator",
        value: { patch: "verified-merge", provenance: ["left", "right"] },
        verification: { status: "pass", verifierId: "independent" },
      };
    },
  });
  const report = await engine.synchronize();
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.converged, ["change-conflict"]);
  assert.deepEqual((await local.get("change-conflict"))?.value, { patch: "verified-merge", provenance: ["left", "right"] });
});

test("goal authority conflicts are never delegated to automatic code integration", async () => {
  const local = new SyncRepository(new MemorySyncStore());
  const remote = new SyncRepository(new MemorySyncStore());
  await local.put(record({ recordId: "goal-authority", entityType: "goal", deviceId: "zbook", clock: { zbook: 1 }, value: { goal: "A" } }));
  await remote.put(record({ recordId: "goal-authority", entityType: "goal", deviceId: "macbook", clock: { macbook: 1 }, value: { goal: "B" } }));
  let called = false;
  const report = await new SyncEngine(local, remote, { async resolve() { called = true; return null; } }).synchronize();
  assert.equal(called, false);
  assert.equal(report.conflicts.length, 1);
});


test("higher coordinator epoch fences concurrent stale replica", () => {
  const local = record({
    recordId: "coordinator:goriq",
    entityType: "coordinator",
    deviceId: "macbook",
    clock: { macbook: 4 },
    value: {
      clusterId: "goriq",
      coordinatorId: "macbook",
      epoch: 1,
      fencingToken: "mac-epoch-1",
      leaseUntil: "2026-09-29T00:01:00.000Z",
    },
  });
  const remote = record({
    recordId: "coordinator:goriq",
    entityType: "coordinator",
    deviceId: "zbook",
    clock: { zbook: 1 },
    value: {
      clusterId: "goriq",
      coordinatorId: "zbook",
      epoch: 2,
      fencingToken: "zbook-epoch-2",
      leaseUntil: "2026-09-29T00:02:00.000Z",
    },
  });
  const decision = resolveSyncRecords(local, remote);
  assert.equal(decision.kind, "remote");
  assert.match(decision.reason, /higher coordinator execution epoch/);
});

test("same coordinator epoch with different owners fails visible as split brain", () => {
  const local = record({
    recordId: "coordinator:goriq",
    entityType: "coordinator",
    deviceId: "macbook",
    clock: { macbook: 1 },
    value: {
      clusterId: "goriq",
      coordinatorId: "macbook",
      epoch: 3,
      fencingToken: "mac-epoch-3",
      leaseUntil: "2026-09-29T00:03:00.000Z",
    },
  });
  const remote = record({
    recordId: "coordinator:goriq",
    entityType: "coordinator",
    deviceId: "zbook",
    clock: { zbook: 1 },
    value: {
      clusterId: "goriq",
      coordinatorId: "zbook",
      epoch: 3,
      fencingToken: "zbook-epoch-3",
      leaseUntil: "2026-09-29T00:03:00.000Z",
    },
  });
  const decision = resolveSyncRecords(local, remote);
  assert.equal(decision.kind, "conflict");
  assert.match(decision.reason, /conflicting owner or fencing token/);
});

test("same coordinator claim converges on later lease renewal", () => {
  const local = record({
    recordId: "coordinator:goriq",
    entityType: "coordinator",
    deviceId: "macbook",
    version: 2,
    clock: { macbook: 2 },
    value: {
      clusterId: "goriq",
      coordinatorId: "macbook",
      epoch: 4,
      fencingToken: "shared-fence",
      leaseUntil: "2026-09-29T00:04:00.000Z",
    },
  });
  const remote = record({
    recordId: "coordinator:goriq",
    entityType: "coordinator",
    deviceId: "zbook",
    version: 2,
    clock: { zbook: 2 },
    value: {
      clusterId: "goriq",
      coordinatorId: "macbook",
      epoch: 4,
      fencingToken: "shared-fence",
      leaseUntil: "2026-09-29T00:05:00.000Z",
    },
  });
  const decision = resolveSyncRecords(local, remote);
  assert.equal(decision.kind, "remote");
  assert.match(decision.reason, /later lease renewal/);
});

function durableRecord(deviceId: string, executionEpoch: number, status = "running"): SyncRecord {
  return record({ recordId: "task:public", entityType: "task", deviceId, clock: { [deviceId]: 1 },
    value: { id: "public", idempotencyKey: "goal1219-public", executionEpoch, status,
      ...(status === "running" ? { leaseOwner: deviceId, fencingToken: deviceId + "-fence-" + executionEpoch,
        leaseUntil: "2026-10-06T00:00:00Z" } : {}) } });
}

test("durable task sync fences old verified completion even when its causal clock dominates", () => {
  const stale = durableRecord("macbook", 1, "completed");
  stale.verification = { status: "pass", verifierId: "old-verifier" };
  const current = durableRecord("zbook", 2);
  for (const clocks of [
    [{ macbook: 2 }, { zbook: 1 }],
    [{ macbook: 9, zbook: 9 }, { zbook: 1 }],
    [{ macbook: 1 }, { macbook: 2, zbook: 1 }],
  ]) {
    stale.clock = clocks[0]; current.clock = clocks[1];
    const forward = resolveSyncRecords(stale, current);
    const reverse = resolveSyncRecords(current, stale);
    assert.equal(forward.kind, "remote");
    assert.equal(reverse.kind, "local");
    assert.equal((forward.record?.value as { executionEpoch: number }).executionEpoch, 2);
  }
});

test("same durable task epoch with conflicting live owners or tokens fails visible", () => {
  const left = durableRecord("macbook", 3);
  const right = durableRecord("zbook", 3);
  right.clock = { macbook: 2, zbook: 2 };
  assert.equal(resolveSyncRecords(left, right).kind, "conflict");
  right.value = { ...(left.value as object), fencingToken: "different-fence" };
  assert.equal(resolveSyncRecords(left, right).kind, "conflict");
});

test("durable task sync rejects missing malformed epochs and conflicting task identity", () => {
  const left = durableRecord("macbook", 2);
  for (const patch of [{ executionEpoch: undefined }, { executionEpoch: -1 },
    { executionEpoch: 1.5 }, { executionEpoch: Number.MAX_SAFE_INTEGER + 1 },
    { id: "another-task" }, { idempotencyKey: "another-goal" }]) {
    const right = durableRecord("zbook", 3);
    right.value = { ...(right.value as object), ...patch };
    assert.equal(resolveSyncRecords(left, right).kind, "conflict");
  }
});

test("same durable claim still converges with causal updates", () => {
  const left = durableRecord("macbook", 2);
  const right = durableRecord("zbook", 2);
  right.clock = { macbook: 1, zbook: 2 };
  right.value = { ...(left.value as object), checkpointRef: "public-checkpoint-v2" };
  assert.equal(resolveSyncRecords(left, right).kind, "remote");
});

test("higher durable task epoch converges in both stores without stale terminal revival", async () => {
  const local = new SyncRepository(new MemorySyncStore());
  const remote = new SyncRepository(new MemorySyncStore());
  const stale = durableRecord("macbook", 1, "completed");
  stale.verification = { status: "pass", verifierId: "old-verifier" };
  await local.put(stale); await remote.put(durableRecord("zbook", 2));
  const report = await new SyncEngine(local, remote).synchronize();
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.converged, ["task:public"]);
  for (const store of [local, remote]) {
    const value = (await store.get("task:public"))?.value as { executionEpoch: number; status: string };
    assert.equal(value.executionEpoch, 2);
    assert.equal(value.status, "running");
  }
});
