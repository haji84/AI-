import assert from "node:assert/strict";
import test from "node:test";
import {
  JarvisControlPlane,
  evaluateJarvisFleetGoalEvidence,
  type JarvisNode,
} from "../src/jarvis/index.ts";

const now = new Date("2026-09-22T00:00:00.000Z");
const connectivity = { mobileOnline: true, pcOnline: true, sameLanAvailable: false } as const;

function node(id: string): JarvisNode {
  return {
    id,
    label: id,
    kind: "android",
    status: "ready",
    capabilities: ["open-url", "background-worker"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: {
      batteryPercent: 80,
      charging: true,
      network: "wifi",
      checkedAt: now.toISOString(),
    },
    enrollment: "full",
    lastSeenAt: now.toISOString(),
  };
}

function enqueueTargetedTask(plane: JarvisControlPlane, id: string, targetNodeId: string) {
  return plane.enqueueTask(
    {
      id,
      idempotencyKey: `acc009:${id}`,
      type: "open-url",
      payload: { url: `https://example.invalid/${id}` },
      requiredCapabilities: ["open-url"],
      priority: "normal",
      requiresOnline: true,
      targetNodeId,
      maxAttempts: 3,
    },
    now,
  );
}

test("ACC-009 keeps distinct devices concurrently in flight and requires every verified child before Goal acceptance", () => {
  const plane = new JarvisControlPlane();
  plane.fleet.register(node("android-a"));
  plane.fleet.register(node("android-b"));
  enqueueTargetedTask(plane, "goal-task-a", "android-a");
  enqueueTargetedTask(plane, "goal-task-b", "android-b");

  const first = plane.dispatch(connectivity, now);
  const second = plane.dispatch(connectivity, now);
  assert.equal(first?.status, "dispatched");
  assert.equal(second?.status, "dispatched");
  assert.deepEqual(new Set([first?.node?.id, second?.node?.id]), new Set(["android-a", "android-b"]));

  plane.markRunning("goal-task-a", "android-a", now);
  plane.markRunning("goal-task-b", "android-b", now);
  assert.equal(plane.snapshot(now).stats.running, 2);

  const beforeCompletion = evaluateJarvisFleetGoalEvidence({
    goalId: "goal-acc009",
    expectedTaskIds: ["goal-task-a", "goal-task-b"],
    tasks: plane.snapshot(now).tasks,
    verification: [
      { taskId: "goal-task-a", verifierPassed: true },
      { taskId: "goal-task-b", verifierPassed: true },
    ],
  });
  assert.equal(beforeCompletion.satisfied, false);
  assert.match(beforeCompletion.blockers.join("\n"), /not completed/);

  plane.completeTask("goal-task-a", "android-a", { observed: "a" }, now);
  plane.completeTask("goal-task-b", "android-b", { observed: "b" }, now);

  const unverified = evaluateJarvisFleetGoalEvidence({
    goalId: "goal-acc009",
    expectedTaskIds: ["goal-task-a", "goal-task-b"],
    tasks: plane.snapshot(now).tasks,
    verification: [
      { taskId: "goal-task-a", verifierPassed: true },
      { taskId: "goal-task-b", verifierPassed: false },
    ],
  });
  assert.equal(unverified.satisfied, false);
  assert.match(unverified.blockers.join("\n"), /goal-task-b lacks verifier PASS/);

  const accepted = evaluateJarvisFleetGoalEvidence({
    goalId: "goal-acc009",
    expectedTaskIds: ["goal-task-a", "goal-task-b"],
    tasks: plane.snapshot(now).tasks,
    verification: [
      { taskId: "goal-task-a", verifierPassed: true },
      { taskId: "goal-task-b", verifierPassed: true },
    ],
  });
  assert.equal(accepted.satisfied, true);
  assert.deepEqual(accepted.completedTaskIds, ["goal-task-a", "goal-task-b"]);
  assert.deepEqual(accepted.verifiedTaskIds, ["goal-task-a", "goal-task-b"]);
  assert.deepEqual(accepted.distinctNodeIds, ["android-a", "android-b"]);
});

test("ACC-009 fails closed on same-device, missing, duplicate, or ambiguous evidence", () => {
  const completed = [
    {
      ...enqueueTaskFixture("task-a", "android-a"),
      status: "completed" as const,
      assignedNodeId: "android-a",
    },
    {
      ...enqueueTaskFixture("task-b", "android-a"),
      status: "completed" as const,
      assignedNodeId: "android-a",
    },
  ];

  const sameDevice = evaluateJarvisFleetGoalEvidence({
    goalId: "goal-same-device",
    expectedTaskIds: ["task-a", "task-b"],
    tasks: completed,
    verification: [
      { taskId: "task-a", verifierPassed: true },
      { taskId: "task-b", verifierPassed: true },
    ],
  });
  assert.equal(sameDevice.satisfied, false);
  assert.match(sameDevice.blockers.join("\n"), /distinct node/);

  const malformed = evaluateJarvisFleetGoalEvidence({
    goalId: "goal-malformed",
    expectedTaskIds: ["task-a", "task-a"],
    tasks: completed,
    verification: [
      { taskId: "task-a", verifierPassed: true },
      { taskId: "task-a", verifierPassed: true },
      { taskId: "unexpected", verifierPassed: true },
    ],
  });
  assert.equal(malformed.satisfied, false);
  assert.match(malformed.blockers.join("\n"), /unique/);
  assert.match(malformed.blockers.join("\n"), /duplicate verifier evidence/);
  assert.match(malformed.blockers.join("\n"), /unexpected task/);
});

function enqueueTaskFixture(id: string, targetNodeId: string) {
  return {
    id,
    idempotencyKey: `fixture:${id}`,
    type: "open-url",
    payload: {},
    status: "queued" as const,
    requiredCapabilities: ["open-url" as const],
    priority: "normal" as const,
    requiresOnline: true,
    targetNodeId,
    attempts: 1,
    maxAttempts: 3,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
