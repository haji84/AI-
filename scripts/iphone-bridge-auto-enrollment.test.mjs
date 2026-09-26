import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("scripts/iphone-bridge-server.ts");

async function waitForBridge(base) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error("bridge did not start");
}

async function jsonRequest(url, { method = "GET", authorization, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  if (response.status !== 204) data = await response.json();
  return { response, data };
}

test("physical iPhone bootstrap is bounded, device-bound, single-use, and reconnectable", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "jarvis-iphone-bridge-"));
  const port = 18787 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}/`;
  const child = spawn(process.execPath, [script], {
    cwd: workdir,
    env: {
      ...process.env,
      IPHONE_BRIDGE_HOST: "127.0.0.1",
      IPHONE_BRIDGE_PORT: String(port),
      IPHONE_ADMIN_TOKEN: "test-admin-token",
      IPHONE_BRIDGE_MASTER_KEY: "test-master-key-which-is-not-production",
      IPHONE_PAIRING_WINDOW_MS: "5000",
      IPHONE_BOOTSTRAP_TTL_MS: "150"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    await rm(workdir, { recursive: true, force: true });
  });

  await waitForBridge(base);

  const discovery = await jsonRequest(`${base}discover`);
  assert.equal(discovery.response.status, 200);
  assert.equal(discovery.data.service, "jarvis-iphone-bridge");
  assert.equal(discovery.data.protocolVersion, 2);
  assert.equal(discovery.data.bootstrapToken, undefined);

  const deviceId = "iphone-test-device-0001";
  const bootstrap = await jsonRequest(`${base}bootstrap`, {
    method: "POST",
    body: { deviceId, clientNonce: "client-nonce-0000000000000001" }
  });
  assert.equal(bootstrap.response.status, 200);
  assert.equal(typeof bootstrap.data.bootstrapToken, "string");

  const competing = await jsonRequest(`${base}bootstrap`, {
    method: "POST",
    body: { deviceId: "iphone-other-device-0002", clientNonce: "client-nonce-0000000000000002" }
  });
  assert.equal(competing.response.status, 409);

  const enrollmentBody = {
    deviceId,
    platform: "ios",
    workerProtocolVersion: 1,
    capabilities: ["ios-tooling", "local-storage", "not-allowed"],
    physicalDevice: true
  };
  const enrolled = await jsonRequest(`${base}enroll`, {
    method: "POST",
    authorization: `Bootstrap ${bootstrap.data.bootstrapToken}`,
    body: enrollmentBody
  });
  assert.equal(enrolled.response.status, 200);
  assert.equal(typeof enrolled.data.deviceSecret, "string");
  assert.deepEqual(enrolled.data.capabilities, ["ios-tooling", "local-storage"]);

  const replay = await jsonRequest(`${base}enroll`, {
    method: "POST",
    authorization: `Bootstrap ${bootstrap.data.bootstrapToken}`,
    body: enrollmentBody
  });
  assert.equal(replay.response.status, 401);

  const reconnect = await jsonRequest(`${base}reconnect`, {
    method: "POST",
    authorization: `Bearer ${enrolled.data.deviceSecret}`,
    body: enrollmentBody
  });
  assert.equal(reconnect.response.status, 200);

  const unauthorizedTask = await jsonRequest(`${base}tasks`, {
    method: "POST",
    authorization: `Bearer ${enrolled.data.deviceSecret}`,
    body: { deviceId, capability: "ios-tooling", input: "nope" }
  });
  assert.equal(unauthorizedTask.response.status, 401);

  const queued = await jsonRequest(`${base}tasks`, {
    method: "POST",
    authorization: "Bearer test-admin-token",
    body: { deviceId, capability: "ios-tooling", input: "ping", taskId: "physical-test-task" }
  });
  assert.equal(queued.response.status, 202);

  const wrongDeviceCredential = await jsonRequest(`${base}tasks/next?deviceId=${deviceId}`, {
    authorization: "Bearer wrong-secret"
  });
  assert.equal(wrongDeviceCredential.response.status, 403);

  const next = await jsonRequest(`${base}tasks/next?deviceId=${deviceId}`, {
    authorization: `Bearer ${enrolled.data.deviceSecret}`
  });
  assert.equal(next.response.status, 200);
  assert.equal(next.data.taskId, "physical-test-task");
  assert.equal(typeof next.data.signature, "string");

  const expiringBootstrap = await jsonRequest(`${base}bootstrap`, {
    method: "POST",
    body: { deviceId, clientNonce: "client-nonce-0000000000000003" }
  });
  assert.equal(expiringBootstrap.response.status, 200);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 220));
  const expired = await jsonRequest(`${base}enroll`, {
    method: "POST",
    authorization: `Bootstrap ${expiringBootstrap.data.bootstrapToken}`,
    body: enrollmentBody
  });
  assert.equal(expired.response.status, 401);
});

test("live acceptance bridge rejects any client outside the expected build binding", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "jarvis-iphone-bridge-bound-"));
  const port = 19787 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}/`;
  const expectedDevice = "goriq-681-device-current";
  const expectedChallenge = "challenge-current-build-123456";
  const child = spawn(process.execPath, [script], {
    cwd: workdir,
    env: {
      ...process.env,
      IPHONE_BRIDGE_HOST: "127.0.0.1",
      IPHONE_BRIDGE_PORT: String(port),
      IPHONE_ADMIN_TOKEN: "test-admin-token",
      IPHONE_BRIDGE_MASTER_KEY: "test-master-key-which-is-not-production",
      IPHONE_EXPECTED_DEVICE_ID: expectedDevice,
      IPHONE_EXPECTED_BUILD_CHALLENGE: expectedChallenge,
      IPHONE_EXPECTED_BUNDLE_ID: "com.haji84.jarvis.iosworker.acceptance",
      IPHONE_PAIRING_WINDOW_MS: "5000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    await rm(workdir, { recursive: true, force: true });
  });
  await waitForBridge(base);

  const wrongDevice = await jsonRequest(`${base}bootstrap`, {
    method: "POST",
    body: { deviceId: "simulated-old-client", clientNonce: "client-nonce-0000000000000001" },
  });
  assert.equal(wrongDevice.response.status, 403);

  const bootstrap = await jsonRequest(`${base}bootstrap`, {
    method: "POST",
    body: { deviceId: expectedDevice, clientNonce: "client-nonce-0000000000000002", buildChallenge: expectedChallenge, bundleIdentifier: "com.haji84.jarvis.iosworker.acceptance" },
  });
  assert.equal(bootstrap.response.status, 200);
  const wrongBuild = await jsonRequest(`${base}enroll`, {
    method: "POST",
    authorization: `Bootstrap ${bootstrap.data.bootstrapToken}`,
    body: {
      deviceId: expectedDevice,
      platform: "ios",
      workerProtocolVersion: 1,
      capabilities: ["ios-tooling"],
      physicalDevice: true,
      buildChallenge: "challenge-from-old-build",
      bundleIdentifier: "com.haji84.jarvis.iosworker.acceptance",
    },
  });
  assert.equal(wrongBuild.response.status, 403);
});
