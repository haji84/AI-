import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JarvisTaskQueue } from "../src/jarvis/task-queue.ts";
import type { JarvisTask } from "../src/jarvis/types.ts";

function queuedTask(id: string, maxAttempts = 3): JarvisTask {
  return {
    id,
    idempotencyKey: `idem-${id}`,
    type: "device-status",
    payload: {},
    status: "queued",
    requiredCapabilities: ["device-status"],
    preferredKinds: ["android"],
    priority: "normal",
    requiresOnline: true,
    targetNodeId: "android-001",
    attempts: 0,
    maxAttempts,
    createdAt: "2026-09-21T18:00:00.000Z",
    updatedAt: "2026-09-21T18:00:00.000Z",
  };
}

test("ACC-003 requeues an interrupted leased task after lease expiry and lets the same Worker finish it", () => {
  const queue = new JarvisTaskQueue();
  const firstLeaseAt = new Date("2026-09-21T18:00:00.000Z");
  const reconnectAt = new Date("2026-09-21T18:00:02.000Z");

  queue.enqueue(queuedTask("acc003-resume"));
  queue.lease("acc003-resume", "android-001", 1_000, firstLeaseAt);
  queue.markRunning("acc003-resume", new Date(firstLeaseAt.getTime() + 100));

  const recovered = queue.next(reconnectAt);
  assert.equal(recovered?.id, "acc003-resume");
  assert.equal(recovered?.status, "queued");
  assert.equal(recovered?.assignedNodeId, undefined);
  assert.equal(recovered?.attempts, 1);

  const leasedAgain = queue.lease("acc003-resume", "android-001", 1_000, reconnectAt);
  assert.equal(leasedAgain.assignedNodeId, "android-001");
  assert.equal(leasedAgain.attempts, 2);
  queue.markRunning("acc003-resume", new Date(reconnectAt.getTime() + 100));
  assert.equal(queue.complete("acc003-resume", new Date(reconnectAt.getTime() + 200)).status, "completed");
});

test("ACC-003 fails closed after the retry budget instead of reconnect-looping forever", () => {
  const queue = new JarvisTaskQueue();
  const startedAt = new Date("2026-09-21T18:00:00.000Z");

  queue.enqueue(queuedTask("acc003-exhausted", 1));
  queue.lease("acc003-exhausted", "android-001", 1_000, startedAt);
  queue.markRunning("acc003-exhausted", new Date(startedAt.getTime() + 100));

  assert.equal(queue.next(new Date(startedAt.getTime() + 2_000)), undefined);
  const failed = queue.get("acc003-exhausted");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.attempts, 1);
  assert.equal(failed?.assignedNodeId, "android-001");
});

test("ACC-003 Android polling survives temporary network failures and resumes without enrollment calls", () => {
  const service = readFileSync("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt", "utf8");

  assert.match(service, /return START_STICKY/);
  assert.match(service, /while \(running\.get\(\)\)/);
  assert.match(service, /client\.heartbeat\(\)/);
  assert.match(service, /client\.nextTask\(\)/);
  assert.match(service, /catch \(_: Throwable\) \{\s*\/\/ Keep the foreground service alive across temporary network\/Broker failures\./);
  assert.doesNotMatch(service, /enrollFromPairingWindow|\.enroll\(|\.enrollGrant\(/);
});

test("ACC-003 reconnect reuses the persistent node identity and AndroidKeyStore signing key", () => {
  const identity = readFileSync("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/DeviceIdentity.kt", "utf8");
  const client = readFileSync("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt", "utf8");

  assert.match(identity, /getSharedPreferences\("jarvis_identity", Context\.MODE_PRIVATE\)/);
  assert.match(identity, /prefs\.getString\("node_id", null\) \?: UUID\.randomUUID\(\)\.toString\(\)\.also/);
  assert.match(identity, /KeyStore\.getInstance\("AndroidKeyStore"\)/);
  assert.match(identity, /private val alias = "jarvis_worker_signing_key"/);
  assert.match(client, /fun nextTask\(\): JSONObject = request\("POST", "\/api\/jarvis\/worker\/next", "\{\}"\.toByteArray\(\), signed = true\)/);
  assert.match(client, /connection\.setRequestProperty\("X-Jarvis-Node-Id", identity\.nodeId\)/);
  assert.match(client, /connection\.setRequestProperty\("X-Jarvis-Signature", identity\.signCanonical\(canonical\)\)/);
});
