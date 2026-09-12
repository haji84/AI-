import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  JarvisControlPlane,
  JarvisNonceRegistry,
  canonicalWorkerRequest,
  verifyWorkerRequest,
  type JarvisNode,
  type JarvisSignedWorkerRequest,
} from "../src/jarvis/index.ts";

function baseNode(id = "android-001"): JarvisNode {
  return {
    id,
    label: id,
    kind: "android",
    status: "ready",
    capabilities: ["open-url", "browser", "remote-view", "remote-control", "wake-device", "background-worker"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: true,
      requireHumanForLockedDevice: true,
    },
    telemetry: { batteryPercent: 90, charging: true, network: "wifi", checkedAt: "2026-09-12T08:00:00.000Z" },
    enrollment: "quick",
    lastSeenAt: "2026-09-12T08:00:00.000Z",
  };
}

test("control plane enrolls, dispatches, completes and audits a URL task", () => {
  const plane = new JarvisControlPlane();
  const now = new Date("2026-09-12T08:00:00.000Z");
  const token = plane.createEnrollment({ mode: "quick", now });
  plane.enroll(token.token, baseNode(), new Date("2026-09-12T08:01:00.000Z"));
  const queued = plane.enqueueTask({
    idempotencyKey: "sheet-row-1",
    type: "open-url",
    payload: { url: "https://example.com" },
    requiredCapabilities: ["open-url"],
    priority: "normal",
    requiresOnline: true,
    maxAttempts: 3,
  }, new Date("2026-09-12T08:02:00.000Z"));
  const dispatched = plane.dispatch({ mobileOnline: true, pcOnline: true, sameLanAvailable: false }, new Date("2026-09-12T08:03:00.000Z"));
  assert.equal(dispatched?.status, "dispatched");
  assert.equal(dispatched?.task.id, queued.id);
  plane.markRunning(queued.id, "android-001", new Date("2026-09-12T08:03:10.000Z"));
  plane.completeTask(queued.id, "android-001", { loaded: true }, new Date("2026-09-12T08:03:20.000Z"));
  const snapshot = plane.snapshot(new Date("2026-09-12T08:04:00.000Z"));
  assert.equal(snapshot.stats.registered, 1);
  assert.equal(snapshot.stats.completed, 1);
  assert(snapshot.audit.some((event) => event.action === "task.completed"));
});

test("control plane pauses a task for Human Takeover and resumes it after resolution", () => {
  const plane = new JarvisControlPlane();
  const token = plane.createEnrollment({ mode: "quick" });
  plane.enroll(token.token, baseNode());
  const task = plane.enqueueTask({
    idempotencyKey: "human-task",
    type: "open-url",
    payload: { url: "https://example.com/login" },
    requiredCapabilities: ["open-url"],
    priority: "normal",
    requiresOnline: true,
    maxAttempts: 3,
  });
  plane.dispatch({ mobileOnline: true, pcOnline: true, sameLanAvailable: false });
  const takeover = plane.requestTakeover({ nodeId: "android-001", taskId: task.id, reason: "unexpected login prompt" });
  assert.equal(plane.queue.get(task.id)?.status, "waiting-human");
  assert.equal(plane.fleet.get("android-001")?.status, "needs-human");
  plane.resolveTakeover(takeover.id, true);
  assert.equal(plane.queue.get(task.id)?.status, "queued");
  assert.equal(plane.fleet.get("android-001")?.status, "ready");
});

test("Ed25519 worker signatures are verified with clock and nonce replay protections", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const body = Buffer.from(JSON.stringify({ batteryPercent: 88 }), "utf8");
  const unsigned = {
    nodeId: "android-001",
    timestamp: "2026-09-12T08:00:00.000Z",
    nonce: "nonce-001",
    method: "POST",
    path: "/api/jarvis/worker/heartbeat",
    bodySha256: createHash("sha256").update(body).digest("hex"),
  };
  const request: JarvisSignedWorkerRequest = {
    ...unsigned,
    signatureBase64: sign(null, Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), privateKey).toString("base64"),
  };
  const nonceRegistry = new JarvisNonceRegistry();
  const identity = {
    nodeId: "android-001",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    enrolledAt: "2026-09-12T07:00:00.000Z",
  };
  const first = verifyWorkerRequest({
    identity,
    request,
    now: new Date("2026-09-12T08:01:00.000Z"),
    seenNonce: (nodeId, nonce) => nonceRegistry.has(nodeId, nonce),
  });
  assert.equal(first.ok, true);
  nonceRegistry.record(request.nodeId, request.nonce);
  const replay = verifyWorkerRequest({
    identity,
    request,
    now: new Date("2026-09-12T08:01:30.000Z"),
    seenNonce: (nodeId, nonce) => nonceRegistry.has(nodeId, nonce),
  });
  assert.equal(replay.ok, false);
  assert.match(replay.reason ?? "", /nonce already used/);
});
