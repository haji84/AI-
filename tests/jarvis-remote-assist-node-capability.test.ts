import assert from "node:assert/strict";
import test from "node:test";
import { remoteAssistDescriptorForNode } from "../src/jarvis/remote-assist-node-capability.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";

function node(patch: Partial<JarvisNode> = {}): JarvisNode {
  return {
    id: "node-1",
    label: "node-1",
    kind: "android",
    status: "ready",
    capabilities: ["remote-view", "remote-control"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: true,
      requireHumanForLockedDevice: true,
    },
    telemetry: { checkedAt: "2026-09-16T00:00:00.000Z" },
    enrollment: "quick",
    lastSeenAt: "2026-09-16T00:00:00.000Z",
    ...patch,
  };
}

test("Android node exposes CONTROLLABLE only when view/control and policy all permit it", () => {
  const controllable = remoteAssistDescriptorForNode(node());
  assert.equal(controllable.capability, "CONTROLLABLE");
  assert.equal(controllable.availability, "available");
  assert.equal(controllable.canControl, true);
  assert.equal(controllable.fullManagementVerified, false);

  const policyDenied = remoteAssistDescriptorForNode(node({
    policy: { ...node().policy, allowRemoteControl: false },
  }));
  assert.equal(policyDenied.capability, "VIEW_ONLY");
  assert.equal(policyDenied.canControl, false);
});

test("iOS always degrades generic Remote Assist control flags to VIEW_ONLY", () => {
  const descriptor = remoteAssistDescriptorForNode(node({ kind: "ios" }));
  assert.equal(descriptor.capability, "VIEW_ONLY");
  assert.equal(descriptor.canView, true);
  assert.equal(descriptor.canControl, false);
  assert.equal(descriptor.fullManagementVerified, false);
  assert.match(descriptor.reason, /iOS generic capability flags do not prove unrestricted external control/);
});

test("nodes without remote-view are explicitly unsupported", () => {
  const descriptor = remoteAssistDescriptorForNode(node({ capabilities: ["remote-control"] }));
  assert.equal(descriptor.capability, null);
  assert.equal(descriptor.availability, "unsupported");
  assert.equal(descriptor.canView, false);
  assert.equal(descriptor.canControl, false);
});

test("offline nodes preserve their declared capability but are unavailable now", () => {
  const descriptor = remoteAssistDescriptorForNode(node({ status: "offline" }));
  assert.equal(descriptor.capability, "CONTROLLABLE");
  assert.equal(descriptor.availability, "temporarily-unavailable");
  assert.equal(descriptor.canView, false);
  assert.equal(descriptor.canControl, false);
  assert.match(descriptor.reason, /current node status is offline/);
});

test("cloud nodes are never promoted to interactive device control", () => {
  const descriptor = remoteAssistDescriptorForNode(node({ kind: "cloud" }));
  assert.equal(descriptor.capability, "VIEW_ONLY");
  assert.equal(descriptor.canControl, false);
  assert.equal(descriptor.fullManagementVerified, false);
});
