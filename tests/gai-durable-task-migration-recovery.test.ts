import assert from "node:assert/strict";
import test from "node:test";
import { DurableTaskRuntime, MemoryDurableTaskStore } from "../src/gai/durable-task-runtime.ts";

const t0 = new Date("2026-09-28T00:00:00.000Z");
const plus = (ms: number) => new Date(t0.getTime() + ms);

test("MIGRATABLE resumes from checkpoint on another node", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({ id: "m1", idempotencyKey: "m1", type: "work", migrationClass: "MIGRATABLE", checkpointRef: "checkpoint://m1/1", maxAttempts: 3 }, t0);
  const first = await runtime.leaseClaim("m1", "macbook", 60_000, plus(1));
  await runtime.markRunningClaimed(first, plus(2));
  await runtime.recoverOrphans(new Set(), plus(3));
  const recovered = await runtime.get("m1");
  assert.equal(recovered?.status, "retrying");
  assert.equal(recovered?.checkpointRef, "checkpoint://m1/1");
  assert.equal(recovered?.history.at(-1)?.evidence?.recoveryMode, "resume");
  assert.equal((await runtime.leaseClaim("m1", "zbook", 60_000, plus(4))).epoch, 2);
});

test("MIGRATABLE without checkpoint waits for protected recovery", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({ id: "m2", idempotencyKey: "m2", type: "work", migrationClass: "MIGRATABLE", maxAttempts: 3 }, t0);
  const claim = await runtime.leaseClaim("m2", "macbook", 60_000, plus(1));
  await runtime.markRunningClaimed(claim, plus(2));
  await runtime.recoverOrphans(new Set(), plus(3));
  assert.equal((await runtime.get("m2"))?.recoveryBlocker, "CHECKPOINT_REQUIRED");
  assert.equal(await runtime.resumeWaiting("resource", plus(4)), 0);
  await assert.rejects(() => runtime.resumeRecovery("m2", {}, plus(5)), /CHECKPOINT_REQUIRED/);
  const resumed = await runtime.resumeRecovery("m2", { checkpointRef: "checkpoint://m2/2" }, plus(6));
  assert.equal(resumed.status, "retrying");
  assert.equal(resumed.checkpointRef, "checkpoint://m2/2");
});

test("RESTARTABLE discards stale checkpoint before another node retries", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await runtime.enqueue({ id: "r1", idempotencyKey: "r1", type: "work", migrationClass: "RESTARTABLE", checkpointRef: "checkpoint://stale", maxAttempts: 3 }, t0);
  const claim = await runtime.leaseClaim("r1", "macbook", 60_000, plus(1));
  await runtime.markRunningClaimed(claim, plus(2));
  await runtime.recoverOrphans(new Set(), plus(3));
  const recovered = await runtime.get("r1");
  assert.equal(recovered?.status, "retrying");
  assert.equal(recovered?.checkpointRef, undefined);
  assert.equal(recovered?.history.at(-1)?.evidence?.recoveryMode, "restart");
  assert.equal((await runtime.leaseClaim("r1", "zbook", 60_000, plus(4))).epoch, 2);
});
