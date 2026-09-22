import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import type { JarvisTask } from "../src/jarvis/types.ts";
import { verifyWorkerRequest } from "../src/jarvis/worker-auth.ts";
import { executeWindowsVerificationTask, validateWindowsVerificationTask } from "../src/jarvis/windows-verification-worker.ts";
import { WindowsVerificationWorkerClient } from "../src/jarvis/windows-worker-client.ts";

function task(overrides: Partial<JarvisTask> = {}): JarvisTask {
  const now = "2026-09-23T00:00:00.000Z";
  return {
    id: "task-win-smoke-1",
    idempotencyKey: "windows-smoke-key",
    type: "windows-real-machine-verification",
    payload: { schema: "jarvis.real-machine.v1", operation: "smoke", payload: { check: "platform" } },
    status: "running",
    requiredCapabilities: ["windows-tooling"],
    preferredKinds: ["windows"],
    priority: "high",
    requiresOnline: true,
    targetNodeId: "win-node-1",
    assignedNodeId: "win-node-1",
    attempts: 1,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("Windows verification task is exact-target, one-attempt and schema bounded", () => {
  assert.deepEqual(validateWindowsVerificationTask(task(), "win-node-1"), { operation: "smoke", check: "platform" });
  assert.throws(() => validateWindowsVerificationTask(task({ targetNodeId: "other" }), "win-node-1"), /windows_worker_node_mismatch/);
  assert.throws(() => validateWindowsVerificationTask(task({ assignedNodeId: "other" }), "win-node-1"), /windows_worker_node_mismatch/);
  assert.throws(() => validateWindowsVerificationTask(task({ maxAttempts: 2 }), "win-node-1"), /windows_worker_attempt_policy_mismatch/);
  assert.throws(() => validateWindowsVerificationTask(task({ requiredCapabilities: [] }), "win-node-1"), /windows_worker_capability_mismatch/);
  assert.throws(() => validateWindowsVerificationTask(task({ preferredKinds: ["android"] }), "win-node-1"), /windows_worker_platform_mismatch/);
  assert.throws(() => validateWindowsVerificationTask(task({ payload: { schema: "jarvis.real-machine.v1", operation: "shell", payload: { check: "platform" } } }), "win-node-1"), /windows_worker_unsupported_operation/);
  assert.throws(() => validateWindowsVerificationTask(task({ payload: { schema: "jarvis.real-machine.v1", operation: "smoke", payload: { check: "platform", command: "whoami" } } }), "win-node-1"), /windows_worker_invalid_smoke_payload/);
});

test("Windows verification executes only a bounded native platform probe", async () => {
  let calls = 0;
  const stdout = '{"platform":"win32","node":"v24.19.0"}\n';
  const result = await executeWindowsVerificationTask({
    task: task(),
    nodeId: "win-node-1",
    runtimePlatform: "win32",
    probe: async () => {
      calls += 1;
      return { stdout, stderr: "", exitCode: 0, timedOut: false };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    schema: "jarvis.real-machine-result.v1",
    operation: "smoke",
    check: "platform",
    platform: "win32",
    nodeVersion: "v24.19.0",
    outputSha256: createHash("sha256").update(stdout).digest("hex"),
    checkIds: ["windows-native-process", "platform-win32"],
  });

  await assert.rejects(() => executeWindowsVerificationTask({
    task: task(),
    nodeId: "win-node-1",
    runtimePlatform: "linux",
    probe: async () => {
      throw new Error("probe must not run");
    },
  }), /windows_worker_not_running_on_windows/);

  await assert.rejects(() => executeWindowsVerificationTask({
    task: task(),
    nodeId: "win-node-1",
    runtimePlatform: "win32",
    probe: async () => ({ stdout: '{"platform":"linux","node":"v24.19.0"}\n', stderr: "", exitCode: 0, timedOut: false }),
  }), /windows_worker_probe_evidence_mismatch/);
});

test("signed Worker client reports bounded evidence and reuses identity after restart without enrollment", async () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const requests: Array<{ path: string; body: string }> = [];
  let nextCalls = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
    const request = {
      nodeId: headers.get("X-Jarvis-Node-Id") ?? "",
      timestamp: headers.get("X-Jarvis-Timestamp") ?? "",
      nonce: headers.get("X-Jarvis-Nonce") ?? "",
      method: init?.method ?? "",
      path: url.pathname,
      bodySha256: headers.get("X-Jarvis-Body-Sha256") ?? "",
      signatureBase64: headers.get("X-Jarvis-Signature") ?? "",
    };
    assert.equal(request.bodySha256, createHash("sha256").update(body).digest("hex"));
    assert.equal(verifyWorkerRequest({
      identity: { nodeId: "win-node-1", publicKeyPem, enrolledAt: "2026-09-23T00:00:00.000Z", algorithm: "ecdsa-p256-sha256" },
      request,
      now: new Date(request.timestamp),
    }).ok, true);
    assert.ok(url.pathname === "/api/jarvis/worker/next" || url.pathname === "/api/jarvis/worker/result");
    requests.push({ path: url.pathname, body });

    if (url.pathname === "/api/jarvis/worker/next") {
      nextCalls += 1;
      return new Response(JSON.stringify({ task: nextCalls === 1 ? task() : null }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ task: { id: "task-win-smoke-1", status: "completed" } }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const options = {
    brokerBaseUrl: "http://127.0.0.1:8787/",
    identity: { nodeId: "win-node-1", privateKeyPem, algorithm: "ecdsa-p256-sha256" as const },
    fetchImpl,
    runtimePlatform: "win32" as const,
    execute: async () => ({
      schema: "jarvis.real-machine-result.v1" as const,
      operation: "smoke" as const,
      check: "platform" as const,
      platform: "win32" as const,
      nodeVersion: "v24.19.0",
      outputSha256: "a".repeat(64),
      checkIds: ["windows-native-process", "platform-win32"] as ["windows-native-process", "platform-win32"],
    }),
  };

  const firstProcess = new WindowsVerificationWorkerClient(options);
  assert.deepEqual(await firstProcess.runOnce(), { status: "completed", taskId: "task-win-smoke-1" });
  const secondProcess = new WindowsVerificationWorkerClient(options);
  assert.deepEqual(await secondProcess.runOnce(), { status: "idle" });

  assert.deepEqual(requests.map((request) => request.path), [
    "/api/jarvis/worker/next",
    "/api/jarvis/worker/result",
    "/api/jarvis/worker/next",
  ]);
  const resultBody = requests[1]?.body ?? "";
  assert.match(resultBody, /jarvis\.real-machine-result\.v1/);
  assert.doesNotMatch(resultBody, /BEGIN PRIVATE KEY/);
  assert.ok(requests.every((request) => !request.path.includes("enroll")));
});

test("Worker client rejects non-TLS remote Broker URLs before network access", () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.throws(() => new WindowsVerificationWorkerClient({
    brokerBaseUrl: "http://example.test/",
    identity: { nodeId: "win-node-1", privateKeyPem, algorithm: "ecdsa-p256-sha256" },
  }), /windows_worker_insecure_broker_url/);
});
