import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { verifyWorkerTaskResult } from "../src/jarvis/task-result-verifier.ts";
import type { JarvisTask } from "../src/jarvis/types.ts";

function runningTask(overrides: Partial<JarvisTask> = {}): JarvisTask {
  return {
    id: "task-1",
    idempotencyKey: "acc002:test",
    type: "open-app",
    payload: { packageName: "com.example.app" },
    status: "running",
    requiredCapabilities: ["open-app"],
    preferredKinds: ["android"],
    priority: "normal",
    requiresOnline: true,
    assignedNodeId: "android-1",
    attempts: 1,
    maxAttempts: 3,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:01.000Z",
    ...overrides,
  };
}

test("ACC-002 host verifier accepts matching task-specific evidence", () => {
  const verification = verifyWorkerTaskResult(
    runningTask(),
    "android-1",
    { packageName: "com.example.app", foreground: true },
  );
  assert.deepEqual(verification, {
    pass: true,
    confidence: 1,
    reason: "open-app-verified",
    checks: ["task-bound", "node-bound", "active-task", "package-match", "foreground"],
  });
});

test("ACC-002 worker self-attestation cannot bypass missing semantic evidence", () => {
  const verification = verifyWorkerTaskResult(
    runningTask(),
    "android-1",
    { verification: { pass: true, confidence: 1, reason: "worker-says-so" } },
  );
  assert.equal(verification.pass, false);
  assert.equal(verification.reason, "open-app-evidence-mismatch");
});

test("ACC-002 fails closed on missing task, wrong node, inactive task, mismatch, and unknown task type", () => {
  assert.equal(verifyWorkerTaskResult(undefined, "android-1", {}).reason, "task-not-found");
  assert.equal(verifyWorkerTaskResult(runningTask(), "android-2", {}).reason, "task-node-mismatch");
  assert.equal(verifyWorkerTaskResult(runningTask({ status: "completed" }), "android-1", {}).reason, "task-not-active");
  assert.equal(verifyWorkerTaskResult(runningTask(), "android-1", { packageName: "wrong", foreground: true }).reason, "open-app-evidence-mismatch");
  assert.equal(verifyWorkerTaskResult(runningTask({ type: "future-task" }), "android-1", {}).reason, "no-host-verifier-for-task-type");
});

test("ACC-002 signed Broker success cannot complete until the host verifier passes", async () => {
  const [broker, controlPlane] = await Promise.all([
    readFile(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/jarvis/control-plane.ts", import.meta.url), "utf8"),
  ]);
  const resultRoute = broker.slice(broker.indexOf('path === "/api/jarvis/worker/result"'), broker.indexOf('return json(response, 404, { message: "unknown worker route" })'));
  const completion = controlPlane.slice(controlPlane.indexOf("completeTask("), controlPlane.indexOf("failTask("));

  assert.match(resultRoute, /payload\.ok \? plane\.completeTask/);
  assert.match(completion, /verifyWorkerTaskResult\(task, nodeId, result \?\? \{\}\)/);
  assert.match(completion, /if \(!verification\.pass\)/);
  assert.match(completion, /Task result verification failed/);
  assert.ok(completion.indexOf("verifyWorkerTaskResult") < completion.indexOf("this.queue.complete"));
});
