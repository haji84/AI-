import assert from "node:assert/strict";
import test from "node:test";
import { JarvisSqliteStateStore } from "../src/jarvis/index.ts";

test("Worker public identities persist locally and can be revoked", () => {
  const store = new JarvisSqliteStateStore(":memory:");
  store.saveWorkerIdentity({
    nodeId: "android-identity-001",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----\n",
    enrolledAt: "2026-09-12T08:00:00.000Z",
    algorithm: "ecdsa-p256-sha256",
  }, new Date("2026-09-12T08:00:00.000Z"));

  assert.equal(store.getWorkerIdentity("android-identity-001")?.algorithm, "ecdsa-p256-sha256");
  assert.equal(store.listWorkerIdentities().length, 1);

  const revoked = store.revokeWorkerIdentity("android-identity-001", new Date("2026-09-12T08:05:00.000Z"));
  assert.equal(revoked?.revokedAt, "2026-09-12T08:05:00.000Z");
  store.close();
});
