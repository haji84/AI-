import assert from "node:assert/strict";
import test from "node:test";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import { JarvisControlPlane } from "../src/jarvis/control-plane.ts";
import type { JarvisWorkerIdentity } from "../src/jarvis/worker-auth.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";
const node = (id: string): JarvisNode => ({ id, label: id, kind: "macos", status: "offline", capabilities: ["filesystem"],
  policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
  telemetry: { checkedAt: "2026-10-01T11:18:17Z" }, enrollment: "quick", lastSeenAt: "2026-10-01T11:18:17Z" });

test("new PC identity and fleet snapshot commit atomically without overwriting identity", () => {
  const store = new JarvisSqliteStateStore(":memory:");
  try {
    const initial = new JarvisControlPlane().snapshot();
    store.save(initial);
    const identity: JarvisWorkerIdentity = { nodeId: "macbook", publicKeyPem: "fixture-public", algorithm: "ed25519", enrolledAt: initial.generatedAt };
    const next = structuredClone(initial);
    next.fleet.push(node("macbook"));
    store.saveNewEnrollment(initial, next, identity);
    assert.equal(store.getWorkerIdentity("macbook")?.publicKeyPem, "fixture-public");
    assert.throws(() => store.saveNewEnrollment(next, next, { ...identity, publicKeyPem: "other" }), /identity.*exists/);
    assert.equal(store.getWorkerIdentity("macbook")?.publicKeyPem, "fixture-public");
  } finally { store.close(); }
});

test("failed snapshot serialization and concurrent snapshot changes never partially enroll", () => {
  const store = new JarvisSqliteStateStore(":memory:");
  try {
    const initial = new JarvisControlPlane().snapshot();
    store.save(initial);
    const identity = { nodeId: "zbook", publicKeyPem: "public", enrolledAt: initial.generatedAt };
    const broken = structuredClone(initial);
    broken.fleet.push(node("zbook"));
    Object.assign(broken, { circular: broken });
    assert.throws(() => store.saveNewEnrollment(initial, broken, identity));
    assert.equal(store.getWorkerIdentity("zbook"), undefined);
    assert.deepEqual(store.load(), initial);
    const changed = { ...initial, generatedAt: "2026-10-01T12:00:00Z" };
    store.save(changed);
    assert.throws(() => store.saveNewEnrollment(initial, initial, identity), /state.*changed/);
    assert.equal(store.getWorkerIdentity("zbook"), undefined);
    assert.deepEqual(store.load(), changed);
  } finally { store.close(); }
});
