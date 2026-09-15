import assert from "node:assert/strict";
import test from "node:test";
import { evaluateJarvisPolicy, type JarvisInteractionOrigin } from "../src/jarvis/policy-engine.ts";
import type { JarvisNode, JarvisTask } from "../src/jarvis/types.ts";

function node(overrides: Partial<JarvisNode> = {}): JarvisNode {
  return {
    id: "android-001",
    label: "android-001",
    kind: "android",
    status: "ready",
    capabilities: ["remote-view", "remote-control"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: true,
      allowExternalPublication: true,
      allowRemoteControl: true,
      requireHumanForLockedDevice: true,
    },
    telemetry: { network: "wifi", checkedAt: "2026-09-16T00:00:00.000Z" },
    enrollment: "quick",
    lastSeenAt: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

function task(): JarvisTask {
  return {
    id: "remote-task-1",
    idempotencyKey: "remote-task-1",
    type: "remote-control",
    payload: { action: "tap", x: 10, y: 20 },
    status: "queued",
    requiredCapabilities: ["remote-control"],
    priority: "normal",
    requiresOnline: false,
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

function decide(origin: JarvisInteractionOrigin, patch: Partial<Parameters<typeof evaluateJarvisPolicy>[0]> = {}) {
  return evaluateJarvisPolicy({
    task: task(),
    node: node(),
    incrementalCostYen: 0,
    interactionOrigin: origin,
    ...patch,
  });
}

test("ordinary zero-cost pointer/gesture remote control remains eligible", () => {
  for (const origin of ["pointer", "gesture"] as const) {
    const decision = decide(origin);
    assert.equal(decision.allowed, true, origin);
    assert.equal(decision.requiresHumanGate, false, origin);
  }
});

test("pointer and gesture can never authorize destructive intent even when node policy allows destructive actions", () => {
  for (const origin of ["pointer", "gesture"] as const) {
    const decision = decide(origin, { destructive: true });
    assert.equal(decision.allowed, false, origin);
    assert.equal(decision.requiresHumanGate, true, origin);
    assert(decision.reasons.includes("destructive action requires Human Gate"));
    assert(decision.reasons.includes(`${origin} input cannot authorize a Human-Gated action`));
  }
});

test("pointer cannot authorize publication even when node policy would otherwise allow it", () => {
  const decision = decide("pointer", { externalPublication: true });
  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresHumanGate, true);
  assert(decision.reasons.includes("external publication requires Human Gate"));
  assert(decision.reasons.includes("pointer input cannot authorize a Human-Gated action"));
});

test("pointer/gesture provenance never weakens secret, permission or paid gates", () => {
  const protectedCases = [
    { requiresSecret: true },
    { requiresPermissionChange: true },
    { incrementalCostYen: 1 },
  ];
  for (const origin of ["pointer", "gesture"] as const) {
    for (const protectedIntent of protectedCases) {
      const decision = decide(origin, protectedIntent);
      assert.equal(decision.allowed, false, `${origin} ${JSON.stringify(protectedIntent)}`);
      assert.equal(decision.requiresHumanGate, true);
      assert(decision.reasons.includes(`${origin} input cannot authorize a Human-Gated action`));
    }
  }
});

test("remote control still fails closed when node policy disables it", () => {
  const decision = evaluateJarvisPolicy({
    task: task(),
    node: node({ policy: { ...node().policy, allowRemoteControl: false } }),
    incrementalCostYen: 0,
    interactionOrigin: "pointer",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresHumanGate, true);
  assert(decision.reasons.includes("remote control is disabled for this node"));
});
