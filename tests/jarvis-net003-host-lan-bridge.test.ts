import assert from "node:assert/strict";
import test from "node:test";
import {
  JARVIS_MAX_NODES,
  JarvisFleetManager,
  resolveJarvisRoute,
  type JarvisNode,
} from "../src/jarvis/index.ts";

function androidNode(index: number): JarvisNode {
  const id = `android-${String(index).padStart(3, "0")}`;
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
      checkedAt: "2026-09-22T09:00:00.000Z",
    },
    enrollment: "full",
    lastSeenAt: "2026-09-22T09:00:00.000Z",
  };
}

test("NET-003 software topology keeps a 100-node Android fleet on the LAN side of one private host", () => {
  const lanRoute = resolveJarvisRoute({ mobileOnline: false, pcOnline: true, sameLanAvailable: true });
  assert.equal(lanRoute.mode, "lan-only");

  const fleet = new JarvisFleetManager();
  for (let i = 1; i <= JARVIS_MAX_NODES; i += 1) fleet.register(androidNode(i));
  assert.equal(JARVIS_MAX_NODES, 100);
  assert.equal(fleet.list().length, 100);
  assert(fleet.list().every((node) => node.kind === "android" && node.telemetry.network === "wifi"));
});
