import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JarvisControlPlane, type JarvisNode } from "../src/jarvis/index.ts";

function node(id: string): JarvisNode {
  const now = "2026-09-28T08:00:00.000Z";
  return {
    id,
    label: id,
    kind: "windows",
    status: "ready",
    capabilities: ["windows-tooling"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: { checkedAt: now },
    enrollment: "full",
    lastSeenAt: now,
  };
}

test("Broker task ownership rotates epoch/token and rejects stale or wrong-node claims", () => {
  const plane = new JarvisControlPlane();
  plane.fleet.register(node("node-a"));
  plane.fleet.register(node("node-b"));
  const queued = plane.enqueueTask({
    idempotencyKey: "fence-1",
    type: "windows-smoke",
    payload: {},
    requiredCapabilities: ["windows-tooling"],
    priority: "normal",
    requiresOnline: true,
    maxAttempts: 3,
  }, new Date("2026-09-28T08:00:00.000Z"));

  const first = plane.dispatch(
    { mobileOnline: true, pcOnline: true, sameLanAvailable: true },
    new Date("2026-09-28T08:00:01.000Z"),
  )!.task;
  assert.equal(first.assignedNodeId, "node-a");
  assert.equal(first.executionEpoch, 1);
  assert.ok((first.fencingToken?.length ?? 0) >= 16);
  const staleToken = first.fencingToken!;

  plane.queue.reclaimExpiredLeases(new Date("2026-09-28T08:03:00.000Z"));
  const second = plane.queue.lease(queued.id, "node-b", 120_000, new Date("2026-09-28T08:03:01.000Z"));
  assert.equal(second.executionEpoch, 2);
  assert.notEqual(second.fencingToken, staleToken);

  assert.throws(
    () => plane.completeTaskClaimed(queued.id, "node-a", 1, staleToken, { stale: true }),
    /STALE_OR_INVALID_TASK_FENCE/,
  );
  assert.throws(
    () => plane.completeTaskClaimed(queued.id, "node-a", second.executionEpoch!, second.fencingToken!, { stolen: true }),
    /STALE_OR_INVALID_TASK_FENCE/,
  );

  plane.markRunningClaimed(queued.id, "node-b", second.executionEpoch!, second.fencingToken!);
  const completed = plane.completeTaskClaimed(
    queued.id,
    "node-b",
    second.executionEpoch!,
    second.fencingToken!,
    { ok: true },
  );
  assert.equal(completed.status, "completed");
});

test("legacy leased task receives an in-place claim before delivery without changing owner", () => {
  const plane = new JarvisControlPlane();
  plane.fleet.register(node("node-a"));
  const now = "2026-09-28T08:00:00.000Z";
  plane.queue.restore([{
    id: "legacy-leased",
    idempotencyKey: "legacy-leased",
    type: "windows-smoke",
    payload: {},
    status: "leased",
    requiredCapabilities: ["windows-tooling"],
    priority: "normal",
    requiresOnline: true,
    assignedNodeId: "node-a",
    leaseUntil: "2026-09-28T08:10:00.000Z",
    attempts: 1,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
  }]);

  const claimed = plane.ensureExecutionClaim("legacy-leased", "node-a", new Date("2026-09-28T08:01:00.000Z"));
  assert.equal(claimed.assignedNodeId, "node-a");
  assert.equal(claimed.executionEpoch, 1);
  assert.ok((claimed.fencingToken?.length ?? 0) >= 16);
});

test("Android Worker echoes Broker-owned epoch/token instead of minting an execution claim", () => {
  const brokerClient = readFileSync("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt", "utf8");
  const executor = readFileSync("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt", "utf8");
  const urlActivity = readFileSync("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/UrlTaskActivity.kt", "utf8");

  assert.match(brokerClient, /put\("executionEpoch", executionEpoch\)/);
  assert.match(brokerClient, /put\("fencingToken", fencingToken\)/);
  assert.match(executor, /task\.optLong\("executionEpoch", 0L\)/);
  assert.match(executor, /task\.optString\("fencingToken"\)/);
  assert.match(executor, /putExtra\("execution_epoch", executionEpoch\)/);
  assert.match(executor, /putExtra\("fencing_token", fencingToken\)/);
  assert.match(urlActivity, /getLongExtra\("execution_epoch", 0L\)/);
  assert.match(urlActivity, /getStringExtra\("fencing_token"\)/);
});
