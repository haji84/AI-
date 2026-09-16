import assert from "node:assert/strict";
import test from "node:test";
import { remoteDeviceInventory } from "../src/jarvis/remote-device-inventory.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";

test("Android8 requires explicit capture readiness and both capabilities", () => {
  const node = { id: "legacy", kind: "android", status: "ready", lastSeenAt: new Date().toISOString(),
    capabilities: [], policy: { allowRemoteControl: true }, telemetry: { checkedAt: new Date().toISOString(),
      accessibilityEnabled: true, androidApi: 26, remoteProtocol: 1, screenCaptureReady: false, workerVersion: "0.4.5" } } as unknown as JarvisNode;
  assert.equal(remoteDeviceInventory([node], [])[0].remoteAssistCapability, null);
  assert.match(remoteDeviceInventory([node], [])[0].reason, /画面共有を開始/);
  node.telemetry!.screenCaptureReady = true;
  assert.equal(remoteDeviceInventory([node], [])[0].remoteAssistCapability, null);
  node.capabilities = ["remote-view", "remote-control"];
  assert.equal(remoteDeviceInventory([node], [])[0].remoteAssistCapability, "CONTROLLABLE");
  node.telemetry!.screenCaptureReady = false;
  assert.equal(remoteDeviceInventory([node], [])[0].remoteAssistCapability, null);
  node.telemetry!.screenCaptureReady = true;
  node.policy.allowRemoteControl = false;
  assert.equal(remoteDeviceInventory([node], [])[0].remoteAssistCapability, null);
});
