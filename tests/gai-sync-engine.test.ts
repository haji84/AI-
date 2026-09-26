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
