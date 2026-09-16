import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableTaskRuntime,
  JsonFileDurableTaskStore,
} from "../src/gai/durable-task-runtime.ts";

test("durable task survives offline wait, restart, reconnect, execution, and second restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-p7-connectivity-"));
  const file = join(dir, "durable-tasks.json");
  const t0 = new Date("2026-09-16T00:00:00.000Z");

  const first = new DurableTaskRuntime(new JsonFileDurableTaskStore(file));
  await first.enqueue({
    id: "task-connectivity-resume",
    idempotencyKey: "p7-connectivity-resume",
    type: "bounded.sync",
    payload: { artifact: "report.json", mode: "safe" },
    checkpointRef: "checkpoint:before-network",
    maxAttempts: 2,
  }, t0);

  const waiting = await first.waitForConnectivity(
    "task-connectivity-resume",
    "network unavailable",
    new Date(t0.getTime() + 1_000),
  );
  assert.equal(waiting.status, "waiting-connectivity");
  assert.equal(await first.next(new Date(t0.getTime() + 2_000)), undefined);

  // Simulate process restart while the network is still unavailable.
  const second = new DurableTaskRuntime(new JsonFileDurableTaskStore(file));
  const afterRestart = await second.get("task-connectivity-resume");
  assert.ok(afterRestart);
  assert.equal(afterRestart.status, "waiting-connectivity");
  assert.deepEqual(afterRestart.payload, { artifact: "report.json", mode: "safe" });
  assert.equal(afterRestart.checkpointRef, "checkpoint:before-network");
  assert.equal(afterRestart.attempts, 0);
  assert.equal(afterRestart.history.at(-1)?.reason, "network unavailable");
  assert.equal(await second.next(new Date(t0.getTime() + 3_000)), undefined);

  // Reconnect is explicit. Merely reopening the store never makes the task run.
  assert.equal(await second.resumeWaiting("connectivity", new Date(t0.getTime() + 4_000)), 1);
  const queued = await second.next(new Date(t0.getTime() + 5_000));
  assert.equal(queued?.id, "task-connectivity-resume");
  assert.equal(queued?.status, "queued");

  await second.lease("task-connectivity-resume", "worker-a", 120_000, new Date(t0.getTime() + 6_000));
  await second.markRunning("task-connectivity-resume", "worker-a", new Date(t0.getTime() + 7_000));
  const completed = await second.complete(
    "task-connectivity-resume",
    "worker-a",
    { verified: true, artifact: "report.json" },
    new Date(t0.getTime() + 8_000),
  );
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, { verified: true, artifact: "report.json" });

  // A second process restart preserves terminal completion rather than replaying work.
  const third = new DurableTaskRuntime(new JsonFileDurableTaskStore(file));
  const afterCompletionRestart = await third.get("task-connectivity-resume");
  assert.equal(afterCompletionRestart?.status, "completed");
  assert.deepEqual(afterCompletionRestart?.result, { verified: true, artifact: "report.json" });
  assert.equal(await third.next(new Date(t0.getTime() + 9_000)), undefined);
  assert.equal(afterCompletionRestart?.history.at(-1)?.reason, "execution verified complete");
});
