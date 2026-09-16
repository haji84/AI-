import assert from "node:assert/strict";
import test from "node:test";
import { remoteDeviceInventory } from "../src/jarvis/remote-device-inventory.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";

test("old Worker is visible with its actual version and update requirement, never controllable", () => {
  const node = { id: "old", kind: "android", label: "Phone", status: "ready", lastSeenAt: new Date().toISOString(),
    capabilities: ["ui-automation"], policy: { allowRemoteControl: true },
    telemetry: { workerVersion: "0.4.2", accessibilityEnabled: true, checkedAt: new Date().toISOString() } } as JarvisNode;
  const device = remoteDeviceInventory([node], [])[0];
  assert.equal(device.remoteAssistCapability, null);
  assert.match(device.reason, /0\.4\.2/); assert.match(device.reason, /0\.4\.3以降/); assert.match(device.reason, /未配信/);
  const current = { ...node, capabilities: ["remote-view", "remote-control"], telemetry: { ...node.telemetry, workerVersion: "0.4.4", remoteProtocol: 1, updateStatus: "Androidの確認待ち" } } as JarvisNode;
  assert.equal(remoteDeviceInventory([current], [])[0].remoteAssistCapability, "CONTROLLABLE");
  assert.match(remoteDeviceInventory([current], [])[0].reason, /Androidの確認待ち/);
});
