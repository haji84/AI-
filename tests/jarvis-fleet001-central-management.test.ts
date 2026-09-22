import assert from "node:assert/strict";
import test from "node:test";

import {
  JARVIS_MAX_NODES,
  JarvisControlPlane,
  JarvisFleetManager,
  type JarvisNode,
} from "../src/jarvis/index.ts";

function node(id: string, group?: string): JarvisNode {
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
      checkedAt: "2026-09-22T10:40:00.000Z",
    },
    enrollment: "quick",
    group,
    lastSeenAt: "2026-09-22T10:40:00.000Z",
  };
}

test("FLEET-001 centrally manages exactly 100 enrolled nodes across deterministic fleet groups", () => {
  const plane = new JarvisControlPlane();
  const groups = ["alpha", "beta", "gamma", "delta"] as const;
  const now = new Date("2026-09-22T10:40:00.000Z");

  for (const group of groups) {
    const token = plane.createEnrollment({
      mode: "fleet",
      maxDevices: 25,
      group,
      now,
    });
    for (let index = 1; index <= 25; index += 1) {
      const id = `${group}-${String(index).padStart(2, "0")}`;
      plane.enroll(token.token, node(id), new Date(now.getTime() + index));
    }
  }

  const snapshot = plane.snapshot(new Date("2026-09-22T10:41:00.000Z"));
  assert.equal(snapshot.stats.registered, JARVIS_MAX_NODES);
  assert.equal(snapshot.fleet.length, JARVIS_MAX_NODES);
  assert.equal(new Set(snapshot.fleet.map((entry) => entry.id)).size, JARVIS_MAX_NODES);

  assert.deepEqual(
    plane.fleet.summarizeGroups().map((summary) => [summary.group, summary.registered, summary.ready]),
    [
      ["alpha", 25, 25],
      ["beta", 25, 25],
      ["delta", 25, 25],
      ["gamma", 25, 25],
    ],
  );
  assert.equal(plane.fleet.listByGroup("beta").length, 25);
  assert.equal(plane.fleet.listByGroup("missing").length, 0);
});

test("FLEET-001 group views are clone-isolated from central fleet state", () => {
  const fleet = new JarvisFleetManager();
  fleet.register(node("alpha-01", "alpha"));

  const listed = fleet.listByGroup("alpha");
  assert.equal(listed.length, 1);
  listed[0].label = "mutated outside manager";
  listed[0].capabilities.length = 0;
  listed[0].telemetry.batteryPercent = 1;

  const persisted = fleet.get("alpha-01");
  assert.equal(persisted?.label, "alpha-01");
  assert.deepEqual(persisted?.capabilities, ["open-url", "background-worker"]);
  assert.equal(persisted?.telemetry.batteryPercent, 80);
});

test("FLEET-001 rejects the 101st distinct node without disturbing the registered hundred", () => {
  const fleet = new JarvisFleetManager();
  for (let index = 1; index <= JARVIS_MAX_NODES; index += 1) {
    fleet.register(node(`android-${String(index).padStart(3, "0")}`, index <= 50 ? "alpha" : "beta"));
  }

  assert.throws(
    () => fleet.register(node("android-101", "overflow")),
    /fleet limit exceeded \(100\)/,
  );
  assert.equal(fleet.list().length, JARVIS_MAX_NODES);
  assert.equal(fleet.get("android-101"), undefined);
});

test("FLEET-001 restore fails closed on duplicate identity and preserves the pre-existing fleet", () => {
  const fleet = new JarvisFleetManager();
  fleet.register(node("stable-01", "stable"));

  const duplicateSnapshot = [
    node("duplicate-01", "alpha"),
    node("duplicate-01", "beta"),
  ];

  assert.throws(
    () => fleet.restore(duplicateSnapshot),
    /Duplicate JARVIS node identity in fleet restore: duplicate-01/,
  );
  assert.deepEqual(fleet.list().map((entry) => entry.id), ["stable-01"]);
  assert.equal(fleet.get("stable-01")?.group, "stable");
});

test("FLEET-001 group summaries account for operational states without merging groups", () => {
  const fleet = new JarvisFleetManager();
  fleet.register(node("a-ready", "alpha"));
  fleet.register(node("a-busy", "alpha"));
  fleet.register(node("a-offline", "alpha"));
  fleet.register(node("a-locked", "alpha"));
  fleet.register(node("a-human", "alpha"));
  fleet.register(node("a-disabled", "alpha"));
  fleet.register(node("ungrouped"));

  fleet.updateHeartbeat("a-busy", { status: "busy" });
  fleet.updateHeartbeat("a-offline", { status: "offline" });
  fleet.updateHeartbeat("a-locked", { status: "locked" });
  fleet.updateHeartbeat("a-human", { status: "needs-human" });
  fleet.updateHeartbeat("a-disabled", { status: "disabled" });

  const summaries = fleet.summarizeGroups();
  assert.deepEqual(summaries.map((summary) => summary.group), ["alpha", null]);
  assert.deepEqual(summaries[0], {
    group: "alpha",
    registered: 6,
    ready: 1,
    busy: 1,
    offline: 1,
    needsHuman: 2,
    disabled: 1,
    kinds: { android: 6 },
  });
  assert.equal(summaries[1].registered, 1);
  assert.equal(summaries[1].ready, 1);
});
