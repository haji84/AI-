import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import { readWorkerIdentityHistory } from "../src/jarvis/worker-identity-history.ts";

async function databasePath() {
  return join(await mkdtemp(join(tmpdir(), "jarvis-worker-history-")), "jarvis.db");
}

const publicKeyPem = "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----\n";

test("OPS-002 worker lifecycle history survives SQLite store reconstruction and is newest-first", async () => {
  const path = await databasePath();
  const first = new JarvisSqliteStateStore(path);
  first.saveWorkerIdentity({
    nodeId: "worker-old",
    publicKeyPem,
    enrolledAt: "2026-09-12T08:00:00.000Z",
    algorithm: "ecdsa-p256-sha256",
  }, new Date("2026-09-12T08:00:00.000Z"));
  first.revokeWorkerIdentity("worker-old", new Date("2026-09-12T08:30:00.000Z"));
  first.saveWorkerIdentity({
    nodeId: "worker-new",
    publicKeyPem,
    enrolledAt: "2026-09-12T09:00:00.000Z",
    algorithm: "ecdsa-p256-sha256",
  }, new Date("2026-09-12T09:00:00.000Z"));
  first.close();

  const restarted = new JarvisSqliteStateStore(path);
  const history = readWorkerIdentityHistory(restarted, { limit: 10 });
  assert.deepEqual(history, [
    { nodeId: "worker-new", event: "enrolled", at: "2026-09-12T09:00:00.000Z" },
    { nodeId: "worker-old", event: "revoked", at: "2026-09-12T08:30:00.000Z" },
    { nodeId: "worker-old", event: "enrolled", at: "2026-09-12T08:00:00.000Z" },
  ]);
  assert.equal("publicKeyPem" in history[0]!, false);
  restarted.close();
});

test("OPS-002 worker lifecycle history is bounded without fabricating additional events", () => {
  const store = new JarvisSqliteStateStore(":memory:");
  store.saveWorkerIdentity({ nodeId: "worker-a", publicKeyPem, enrolledAt: "2026-09-12T08:00:00.000Z" });
  store.saveWorkerIdentity({ nodeId: "worker-b", publicKeyPem, enrolledAt: "2026-09-12T09:00:00.000Z" });

  const history = readWorkerIdentityHistory(store, { limit: 1 });
  assert.deepEqual(history, [{ nodeId: "worker-b", event: "enrolled", at: "2026-09-12T09:00:00.000Z" }]);
  assert.throws(() => readWorkerIdentityHistory(store, { limit: 0 }), /integer from 1 to 200/);
  assert.throws(() => readWorkerIdentityHistory(store, { limit: 201 }), /integer from 1 to 200/);
  store.close();
});

test("OPS-002 worker lifecycle history fails closed on malformed or impossible timestamps", () => {
  const malformed = new JarvisSqliteStateStore(":memory:");
  malformed.saveWorkerIdentity({ nodeId: "worker-bad-time", publicKeyPem, enrolledAt: "not-a-date" });
  assert.throws(() => readWorkerIdentityHistory(malformed), /invalid worker enrollment timestamp/);
  malformed.close();

  const impossible = new JarvisSqliteStateStore(":memory:");
  impossible.saveWorkerIdentity({
    nodeId: "worker-time-travel",
    publicKeyPem,
    enrolledAt: "2026-09-12T09:00:00.000Z",
    revokedAt: "2026-09-12T08:00:00.000Z",
  });
  assert.throws(() => readWorkerIdentityHistory(impossible), /revocation timestamp precedes enrollment/);
  impossible.close();
});
