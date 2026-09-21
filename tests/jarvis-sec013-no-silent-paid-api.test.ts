import assert from "node:assert/strict";
import test from "node:test";
import { evaluateJarvisPolicy, type JarvisNode, type JarvisTask } from "../src/jarvis/index.ts";

function task(): JarvisTask {
  return {
    id: "sec013-task",
    idempotencyKey: "sec013-task",
    type: "open-url",
    payload: { url: "https://example.com" },
    status: "queued",
    requiredCapabilities: ["open-url"],
    priority: "normal",
    requiresOnline: true,
    attempts: 0,
    maxAttempts: 1,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };
}

function node(): JarvisNode {
  return {
    id: "sec013-node",
    label: "SEC-013 node",
    kind: "android",
    status: "ready",
    capabilities: ["open-url"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: {
      batteryPercent: 100,
      charging: true,
      network: "wifi",
      checkedAt: "2026-09-21T00:00:00.000Z",
    },
    enrollment: "full",
    lastSeenAt: "2026-09-21T00:00:00.000Z",
  };
}

test("SEC-013 allows only explicit no-paid policy with zero incremental cost", () => {
  const decision = evaluateJarvisPolicy({
    task: task(),
    node: node(),
    incrementalCostYen: 0,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresHumanGate, false);
  assert.deepEqual(decision.reasons, ["zero-cost route and node policy satisfied"]);
});

test("SEC-013 requires Human Gate for any positive incremental cost even when no-paid policy is explicit", () => {
  for (const incrementalCostYen of [0.01, 1, 1000]) {
    const decision = evaluateJarvisPolicy({
      task: task(),
      node: node(),
      incrementalCostYen,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.requiresHumanGate, true);
    assert.ok(decision.reasons.includes("additional paid service is not allowed by default"));
  }
});

test("SEC-013 cannot silently enable paid services by setting allowPaidServices true", () => {
  const baseline = node();
  const malformedPersistedNode = {
    ...baseline,
    policy: {
      ...baseline.policy,
      allowPaidServices: true,
    },
  } as unknown as JarvisNode;

  const decision = evaluateJarvisPolicy({
    task: task(),
    node: malformedPersistedNode,
    incrementalCostYen: 0,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresHumanGate, true);
  assert.ok(decision.reasons.includes("additional paid service is not allowed by default"));
});

test("SEC-013 fails closed when allowPaidServices is missing from persisted policy state", () => {
  const baseline = node();
  const malformedPersistedNode = {
    ...baseline,
    policy: {
      allowDestructiveActions: baseline.policy.allowDestructiveActions,
      allowExternalPublication: baseline.policy.allowExternalPublication,
      allowRemoteControl: baseline.policy.allowRemoteControl,
      requireHumanForLockedDevice: baseline.policy.requireHumanForLockedDevice,
    },
  } as unknown as JarvisNode;

  const decision = evaluateJarvisPolicy({
    task: task(),
    node: malformedPersistedNode,
    incrementalCostYen: 0,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresHumanGate, true);
  assert.ok(decision.reasons.includes("additional paid service is not allowed by default"));
});
