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
