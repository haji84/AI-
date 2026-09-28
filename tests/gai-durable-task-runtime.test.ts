import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableTaskRuntime,
  JsonFileDurableTaskStore,
  MemoryDurableTaskStore,
} from "../src/gai/durable-task-runtime.ts";

const t0 = new Date("2026-09-15T00:00:00.000Z");

function plus(ms: number): Date {
  return new Date(t0.getTime() + ms);
}

test("durable task survives runtime reconstruction with checkpoint reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gai-durable-"));
  const file = join(dir, "tasks.json");
  try {
    const first = new DurableTaskRuntime(new JsonFileDurableTaskStore(file));
    await first.enqueue({
      id: "persist-1",
      idempotencyKey: "persist-key",
      type: "research",
      requiredCapabilities: ["local-model"],
      checkpointRef: "checkpoint://persist-1/1",
    }, t0);
    await first.lease("persist-1", "zbook", 60_000, plus(1_000));
    await first.markRunning("persist-1", "zbook", plus(2_000));

    const second = new DurableTaskRuntime(new JsonFileDurableTaskStore(file));
    await second.initialize();
    const restored = await second.get("persist-1");
    assert.equal(restored?.status, "running");
    assert.equal(restored?.leaseOwner, "zbook");
    assert.equal(restored?.checkpointRef, "checkpoint://persist-1/1");
    assert.equal(restored?.attempts, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("idempotency prevents duplicate active or completed work", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  const first = await runtime.enqueue({ id: "idempotent-1", idempotencyKey: "same", type: "work" }, t0);
  const duplicate = await runtime.enqueue({ id: "idempotent-2", idempotencyKey: "same", type: "work" }, plus(1));
  assert.equal(duplicate.id, first.id);
  assert.equal((await runtime.list()).length, 1);

  await runtime.lease(first.id, "worker", 1_000, plus(2));
  await runtime.complete(first.id, "worker", { ok: true }, plus(3));
  const afterComplete = await runtime.enqueue({ id: "idempotent-3", idempotencyKey: "same", type: "work" }, plus(4));
  assert.equal(afterComplete.id, first.id);
  assert.equal((await runtime.list()).length, 1);
});

test("dependency gates execution until parent completes", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({ id: "parent", idempotencyKey: "parent", type: "work" }, t0);
  const child = await runtime.enqueue({ id: "child", idempotencyKey: "child", type: "work", dependsOn: ["parent"] }, plus(1));
  assert.equal(child.status, "waiting-dependency");
  assert.rejects(() => runtime.lease("child", "worker", 1_000, plus(2)), /cannot be leased/);

  await runtime.lease("parent", "worker", 1_000, plus(3));
  await runtime.complete("parent", "worker", undefined, plus(4));
  const readyChild = await runtime.get("child");
  assert.equal(readyChild?.status, "queued");
  const leasedChild = await runtime.lease("child", "worker", 1_000, plus(5));
  assert.equal(leasedChild.status, "leased");
});

test("failed or cancelled dependency fails dependent task visibly", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({ id: "parent-fail", idempotencyKey: "pf", type: "work", maxAttempts: 1 }, t0);
  await runtime.enqueue({ id: "child-fail", idempotencyKey: "cf", type: "work", dependsOn: ["parent-fail"] }, plus(1));
  await runtime.lease("parent-fail", "worker", 1_000, plus(2));
  await runtime.fail("parent-fail", "worker", "boom", 0, plus(3));
  const child = await runtime.get("child-fail");
  assert.equal(child?.status, "failed");
  assert.match(child?.error ?? "", /Dependency parent-fail ended as failed/);
});

test("lease expiry retries until budget then fails", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({ id: "lease-task", idempotencyKey: "lease", type: "work", maxAttempts: 2 }, t0);
  await runtime.lease("lease-task", "worker-a", 100, plus(1));
  assert.equal(await runtime.reclaimExpiredLeases(plus(200)), 1);
  assert.equal((await runtime.get("lease-task"))?.status, "retrying");

  await runtime.lease("lease-task", "worker-b", 100, plus(201));
  assert.equal(await runtime.reclaimExpiredLeases(plus(400)), 1);
  const failed = await runtime.get("lease-task");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.attempts, 2);
});

test("orphan recovery after restart requeues work whose owner is no longer active", async () => {
  const store = new MemoryDurableTaskStore();
  const first = new DurableTaskRuntime(store);
  await first.enqueue({ id: "orphan", idempotencyKey: "orphan", type: "work", maxAttempts: 3 }, t0);
  await first.lease("orphan", "dead-runtime", 60_000, plus(1));
  await first.markRunning("orphan", "dead-runtime", plus(2));

  const restarted = new DurableTaskRuntime(store);
  await restarted.initialize();
  assert.equal(await restarted.recoverOrphans(new Set(), plus(3)), 1);
  const recovered = await restarted.get("orphan");
  assert.equal(recovered?.status, "retrying");
  assert.equal(recovered?.leaseOwner, undefined);
  assert.match(recovered?.history.at(-1)?.reason ?? "", /orphaned execution recovered/);
});

test("waiting connectivity/resource states persist and resume explicitly", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({ id: "offline", idempotencyKey: "offline", type: "work" }, t0);
  await runtime.waitForConnectivity("offline", "network lost", plus(1));
  assert.equal((await runtime.get("offline"))?.status, "waiting-connectivity");
  assert.equal(await runtime.resumeWaiting("connectivity", plus(2)), 1);
  assert.equal((await runtime.get("offline"))?.status, "queued");

  await runtime.waitForResource("offline", "gpu busy", plus(3));
  assert.equal((await runtime.get("offline"))?.status, "waiting-resource");
  assert.equal(await runtime.resumeWaiting("resource", plus(4)), 1);
  assert.equal((await runtime.get("offline"))?.status, "queued");
});

test("invalid terminal transitions fail visibly", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({ id: "terminal", idempotencyKey: "terminal", type: "work" }, t0);
  await runtime.lease("terminal", "worker", 1_000, plus(1));
  await runtime.complete("terminal", "worker", undefined, plus(2));
  await assert.rejects(() => runtime.cancel("terminal", "too late", plus(3)), /cannot be cancelled/);
  await assert.rejects(() => runtime.markRunning("terminal", "worker", plus(4)), /must be leased/);
  await assert.rejects(() => runtime.setCheckpointRef("terminal", "new", plus(5)), /terminal task/);
});


test("distributed execution claim advances epoch and rejects stale fenced owner", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({
    id: "fenced",
    idempotencyKey: "fenced",
    type: "work",
    migrationClass: "MIGRATABLE",
    maxAttempts: 3,
  }, t0);

  const first = await runtime.leaseClaim("fenced", "macbook", 100, plus(1));
  assert.equal(first.epoch, 1);
  assert.ok(first.fencingToken);
  await runtime.markRunningClaimed(first, plus(2));
  await runtime.setCheckpointRefClaimed(first, "checkpoint://fenced/mac/1", plus(3));

  await assert.rejects(
    () => runtime.completeClaimed(first, { late: true }, plus(102)),
    /STALE_EXECUTION_CLAIM/,
  );

  assert.equal(await runtime.reclaimExpiredLeases(plus(102)), 1);
  const second = await runtime.leaseClaim("fenced", "zbook", 100, plus(103));
  assert.equal(second.epoch, 2);
  assert.notEqual(second.fencingToken, first.fencingToken);

  for (const operation of [
    () => runtime.heartbeatClaimed(first, 100, plus(104)),
    () => runtime.markRunningClaimed(first, plus(104)),
    () => runtime.setCheckpointRefClaimed(first, "checkpoint://stale", plus(104)),
    () => runtime.completeClaimed(first, { stale: true }, plus(104)),
    () => runtime.readyToPublishClaimed(first, { stale: true }, plus(104)),
    () => runtime.failClaimed(first, "stale failure", 0, plus(104)),
  ]) {
    await assert.rejects(operation, /STALE_EXECUTION_CLAIM/);
  }

  await runtime.markRunningClaimed(second, plus(105));
  await runtime.setCheckpointRefClaimed(second, "checkpoint://fenced/zbook/2", plus(106));
  const completed = await runtime.completeClaimed(second, { owner: "zbook" }, plus(107));
  assert.equal(completed.status, "completed");
  assert.equal(completed.executionEpoch, 2);
  assert.equal(completed.fencingToken, undefined);
  assert.equal(completed.checkpointRef, "checkpoint://fenced/zbook/2");
  assert.deepEqual(completed.result, { owner: "zbook" });
});

test("legacy durable snapshot defaults to restartable epoch zero without inventing a fence", async () => {
  const legacyTask = {
    id: "legacy",
    idempotencyKey: "legacy",
    type: "work",
    payload: {},
    status: "queued",
    priority: "normal",
    requiredCapabilities: [],
    dependsOn: [],
    attempts: 0,
    maxAttempts: 3,
    createdAt: t0.toISOString(),
    updatedAt: t0.toISOString(),
    history: [],
  };
  const store = {
    async load() {
      return { version: 1 as const, tasks: [legacyTask] as never, savedAt: t0.toISOString() };
    },
    async save() {},
  };
  const runtime = new DurableTaskRuntime(store);
  await runtime.initialize();
  const restored = await runtime.get("legacy");
  assert.equal(restored?.migrationClass, "RESTARTABLE");
  assert.equal(restored?.executionEpoch, 0);
  assert.equal(restored?.fencingToken, undefined);
});

test("task migration class is explicit and invalid runtime values fail closed", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  const pinned = await runtime.enqueue({
    id: "pinned",
    idempotencyKey: "pinned",
    type: "sensor",
    migrationClass: "PINNED",
  }, t0);
  assert.equal(pinned.migrationClass, "PINNED");

  await assert.rejects(
    () => runtime.enqueue({
      id: "bad-class",
      idempotencyKey: "bad-class",
      type: "work",
      migrationClass: "UNKNOWN" as never,
    }, plus(1)),
    /invalid migrationClass/,
  );
});


test("MIGRATABLE recovery resumes only from a durable checkpoint", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({
    id: "migratable-checkpoint",
    idempotencyKey: "migratable-checkpoint",
    type: "work",
    migrationClass: "MIGRATABLE",
    checkpointRef: "checkpoint://migratable/1",
  }, t0);
  const first = await runtime.leaseClaim("migratable-checkpoint", "macbook", 100, plus(1));
  await runtime.markRunningClaimed(first, plus(2));
  assert.equal(await runtime.reclaimExpiredLeases(plus(200)), 1);
  const recovered = await runtime.get("migratable-checkpoint");
  assert.equal(recovered?.status, "retrying");
  assert.equal(recovered?.checkpointRef, "checkpoint://migratable/1");
  assert.equal(recovered?.waitReason, undefined);

  const second = await runtime.leaseClaim("migratable-checkpoint", "zbook", 100, plus(201));
  assert.equal(second.epoch, 2);
  assert.equal(second.owner, "zbook");

  await runtime.enqueue({
    id: "migratable-no-checkpoint",
    idempotencyKey: "migratable-no-checkpoint",
    type: "work",
    migrationClass: "MIGRATABLE",
  }, plus(300));
  const noCheckpoint = await runtime.leaseClaim("migratable-no-checkpoint", "macbook", 100, plus(301));
  await runtime.markRunningClaimed(noCheckpoint, plus(302));
  assert.equal(await runtime.reclaimExpiredLeases(plus(500)), 1);
  const waiting = await runtime.get("migratable-no-checkpoint");
  assert.equal(waiting?.status, "waiting-resource");
  assert.equal(waiting?.waitReason, "migration-checkpoint");
  assert.equal(await runtime.resumeWaiting("resource", plus(501)), 0);

  const resumed = await runtime.provideMigrationCheckpoint(
    "migratable-no-checkpoint",
    "checkpoint://recovered/2",
    plus(502),
  );
  assert.equal(resumed.status, "retrying");
  assert.equal(resumed.waitReason, undefined);
  assert.equal(resumed.checkpointRef, "checkpoint://recovered/2");
});

test("RESTARTABLE recovery can move to another eligible node", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({
    id: "restartable-node-loss",
    idempotencyKey: "restartable-node-loss",
    type: "work",
    migrationClass: "RESTARTABLE",
  }, t0);
  const mac = await runtime.leaseClaim("restartable-node-loss", "macbook", 100, plus(1));
  await runtime.markRunningClaimed(mac, plus(2));
  assert.equal(await runtime.recoverOrphans(new Set(), plus(3)), 1);
  const recovered = await runtime.get("restartable-node-loss");
  assert.equal(recovered?.status, "retrying");
  assert.equal(recovered?.waitReason, undefined);
  const zbook = await runtime.leaseClaim("restartable-node-loss", "zbook", 100, plus(4));
  assert.equal(zbook.owner, "zbook");
  assert.equal(zbook.epoch, 2);
});

test("PINNED recovery waits for the same node and rejects another node", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await assert.rejects(
    () => runtime.enqueue({
      id: "bad-pinned",
      idempotencyKey: "bad-pinned",
      type: "sensor",
      migrationClass: "PINNED",
    }, t0),
    /pinnedNodeId/,
  );
  await runtime.enqueue({
    id: "pinned-node-loss",
    idempotencyKey: "pinned-node-loss",
    type: "sensor",
    migrationClass: "PINNED",
    pinnedNodeId: "zbook",
  }, plus(1));
  await assert.rejects(
    () => runtime.leaseClaim("pinned-node-loss", "macbook", 100, plus(2)),
    /PINNED_TASK_WRONG_NODE/,
  );
  const zbook = await runtime.leaseClaim("pinned-node-loss", "zbook", 100, plus(3));
  await runtime.markRunningClaimed(zbook, plus(4));
  assert.equal(await runtime.recoverOrphans(new Set(), plus(5)), 1);
  const waiting = await runtime.get("pinned-node-loss");
  assert.equal(waiting?.status, "waiting-resource");
  assert.equal(waiting?.waitReason, "pinned-node");
  assert.equal(waiting?.pinnedNodeId, "zbook");
  assert.equal(await runtime.resumeWaiting("resource", plus(6)), 0);
  assert.equal(await runtime.resumePinnedNode("macbook", plus(7)), 0);
  assert.equal(await runtime.resumePinnedNode("zbook", plus(8)), 1);
  await assert.rejects(
    () => runtime.leaseClaim("pinned-node-loss", "macbook", 100, plus(9)),
    /PINNED_TASK_WRONG_NODE/,
  );
  const returned = await runtime.leaseClaim("pinned-node-loss", "zbook", 100, plus(10));
  assert.equal(returned.owner, "zbook");
  assert.equal(returned.epoch, 2);
});

test("SIDE_EFFECTING recovery requires reconciliation evidence before retry or completion", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({
    id: "side-effect-node-loss",
    idempotencyKey: "side-effect-node-loss",
    type: "publish",
    migrationClass: "SIDE_EFFECTING",
  }, t0);
  const claim = await runtime.leaseClaim("side-effect-node-loss", "macbook", 100, plus(1));
  await runtime.markRunningClaimed(claim, plus(2));
  assert.equal(await runtime.reclaimExpiredLeases(plus(200)), 1);
  const waiting = await runtime.get("side-effect-node-loss");
  assert.equal(waiting?.status, "waiting-resource");
  assert.equal(waiting?.waitReason, "side-effect-reconciliation");
  assert.equal(await runtime.resumeWaiting("resource", plus(201)), 0);

  await assert.rejects(
    () => runtime.reconcileSideEffect("side-effect-node-loss", "verifier", "retry", {}, undefined, plus(202)),
    /evidence is required/,
  );
  const retry = await runtime.reconcileSideEffect(
    "side-effect-node-loss",
    "verifier",
    "retry",
    { externalEffectObserved: false, verifier: "receipt-probe" },
    undefined,
    plus(203),
  );
  assert.equal(retry.status, "retrying");
  assert.equal(retry.waitReason, undefined);

  const retryClaim = await runtime.leaseClaim("side-effect-node-loss", "zbook", 100, plus(204));
  await runtime.markRunningClaimed(retryClaim, plus(205));
  assert.equal(await runtime.recoverOrphans(new Set(), plus(206)), 1);
  const completed = await runtime.reconcileSideEffect(
    "side-effect-node-loss",
    "verifier",
    "completed",
    { externalEffectObserved: true, receiptVerified: true },
    { receiptId: "verified-existing-effect" },
    plus(207),
  );
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, { receiptId: "verified-existing-effect" });
});


test("invalid persisted migration recovery metadata fails closed", async () => {
  const base = {
    id: "persisted-invalid",
    idempotencyKey: "persisted-invalid",
    type: "work",
    payload: {},
    status: "queued",
    priority: "normal",
    requiredCapabilities: [],
    dependsOn: [],
    attempts: 0,
    maxAttempts: 3,
    executionEpoch: 0,
    createdAt: t0.toISOString(),
    updatedAt: t0.toISOString(),
    history: [],
  };
  for (const invalid of [
    { ...base, migrationClass: "UNKNOWN" },
    { ...base, migrationClass: "PINNED" },
    { ...base, migrationClass: "RESTARTABLE", pinnedNodeId: "zbook" },
    { ...base, migrationClass: "RESTARTABLE", waitReason: "invented-wait" },
  ]) {
    const store = {
      async load() {
        return { version: 1 as const, tasks: [invalid] as never, savedAt: t0.toISOString() };
      },
      async save() {},
    };
    const runtime = new DurableTaskRuntime(store);
    await assert.rejects(() => runtime.initialize(), /persisted|PINNED|pinnedNodeId|waitReason/i);
  }
});
