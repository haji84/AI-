import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { PendingEnrollment } from "../src/jarvis/pending-enrollment.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";

test("pending requests are bounded, expire at 30 minutes, and bind owner selection to an exact key offer", () => {
  const pending = new PendingEnrollment();
  const key = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "pem", type: "spki" }).toString();
  const node: JarvisNode = { id: "one", label: "Fixture", kind: "android", status: "offline", capabilities: [], policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true }, telemetry: { checkedAt: new Date().toISOString() }, enrollment: "quick", lastSeenAt: new Date().toISOString() };
  const identity = { nodeId: node.id, publicKeyPem: key(), enrolledAt: new Date().toISOString(), algorithm: "ecdsa-p256-sha256" as const };
  const offered = pending.offer(node, identity, 1_000);
  assert.equal(offered.expiresAt, 1_801_000);
  const originalId = pending.list(1_000)[0].id;
  pending.offer(node, identity, 2_000);
  assert.equal(pending.list(2_000)[0].id, originalId);
  assert.throws(() => pending.offer(node, { ...identity, publicKeyPem: key() }, 2_000));
  assert.equal(pending.selected([originalId], 2_000)[0].identity.publicKeyPem, identity.publicKeyPem);
  assert.throws(() => pending.selected([originalId, originalId], 2_000));
  assert.equal(pending.list(1_801_000).length, 0);
  pending.offer(node, { ...identity, publicKeyPem: key() }, 1_801_001);
  assert.throws(() => pending.selected([originalId], 1_801_001), "old approval cannot approve a new key offer");
  for (let i = 1; i < 100; i++) pending.offer({ ...node, id: String(i) }, { ...identity, nodeId: String(i) }, 1_801_002);
  assert.throws(() => pending.offer({ ...node, id: "overflow" }, { ...identity, nodeId: "overflow" }, 1_801_002));
});
