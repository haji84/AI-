import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import test from "node:test";

import { DeviceCapabilityRuntime } from "../src/gai/device-capability-runtime.ts";
import { createFunctionWorker, MultiWorkerRuntime, type WorkerDescriptor } from "../src/gai/worker-runtime.ts";
import type { TaskProfile } from "../src/gai/types.ts";

const gatewayPath = resolve("scripts/jarvis-remote-gateway.ts");
const ownerToken = "sec008-test-owner-token";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForListening(child: ReturnType<typeof spawn>, output: { stdout: string; stderr: string }): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (output.stdout.includes("[jarvis-remote-gateway] listening")) return;
    if (child.exitCode !== null) throw new Error(`gateway exited before listening: ${output.stderr}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`gateway did not start in time: ${output.stderr}`);
}

async function requestJson(port: number, path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function makeFakeAdb(directory: string): Promise<{ path: string; logPath: string }> {
  const logPath = join(directory, "adb-calls.log");
  const path = join(directory, "fake-adb.mjs");
  await writeFile(path, `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nconst args = process.argv.slice(2);\nappendFileSync(process.env.JARVIS_FAKE_ADB_LOG, JSON.stringify(args) + "\\n");\nif (args.length === 1 && args[0] === "devices") {\n  process.stdout.write("List of devices attached\\nALLOWED-1\\tdevice\\nDENIED-1\\tdevice\\n");\n  process.exit(0);\n}\nif (args[0] === "-s" && args[1] === "ALLOWED-1") process.exit(0);\nprocess.stderr.write("fake adb rejected unexpected invocation");\nprocess.exit(23);\n`, "utf8");
  await chmod(path, 0o755);
  return { path, logPath };
}

test("SEC-008 fails closed when the remote device allowlist is empty", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-sec008-empty-"));
  try {
    const fake = await makeFakeAdb(directory);
    const port = await freePort();
    const child = spawn(process.execPath, ["--import", new URL("./fixtures/fake-adb-launcher.mjs", import.meta.url).href, gatewayPath], {
      env: {
        ...process.env,
        JARVIS_REMOTE_GATEWAY_HOST: "127.0.0.1",
        JARVIS_REMOTE_GATEWAY_PORT: String(port),
        JARVIS_REMOTE_GATEWAY_TOKEN: ownerToken,
        JARVIS_REMOTE_ALLOWED_SERIALS: "  ,  ",
        JARVIS_ADB_PATH: fake.path,
        JARVIS_FAKE_ADB_LOG: fake.logPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const [code] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    assert.notEqual(code, 0);
    assert.match(stderr, /JARVIS_REMOTE_ALLOWED_SERIALS must contain at least one authorized Android serial/);
    await assert.rejects(() => readFile(fake.logPath, "utf8"), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SEC-008 filters discovery and rejects a non-allowlisted serial before device execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-sec008-gateway-"));
  const fake = await makeFakeAdb(directory);
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", new URL("./fixtures/fake-adb-launcher.mjs", import.meta.url).href, gatewayPath], {
    env: {
      ...process.env,
      JARVIS_REMOTE_GATEWAY_HOST: "127.0.0.1",
      JARVIS_REMOTE_GATEWAY_PORT: String(port),
      JARVIS_REMOTE_GATEWAY_TOKEN: ownerToken,
      JARVIS_REMOTE_ALLOWED_SERIALS: " ALLOWED-1 , ALLOWED-1 ",
      JARVIS_ADB_PATH: fake.path,
      JARVIS_FAKE_ADB_LOG: fake.logPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => { output.stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { output.stderr += String(chunk); });

  try {
    await waitForListening(child, output);

    const health = await requestJson(port, "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body.devices, [{ serial: "ALLOWED-1", state: "device" }]);

    const denied = await requestJson(port, "/api/remote/input", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ serial: "DENIED-1", action: "keyevent", key: "HOME" }),
    });
    assert.equal(denied.status, 400);
    assert.match(String(denied.body.message), /not authorized/);

    const afterDenied = await readFile(fake.logPath, "utf8");
    assert.doesNotMatch(afterDenied, /DENIED-1/);

    const allowed = await requestJson(port, "/api/remote/input", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ serial: "ALLOWED-1", action: "keyevent", key: "HOME" }),
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.ok, true);

    const afterAllowed = await readFile(fake.logPath, "utf8");
    assert.match(afterAllowed, /\["-s","ALLOWED-1","shell","input","keyevent","KEYCODE_HOME"\]/);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    await rm(directory, { recursive: true, force: true });
  }
});

test("SEC-008 excluded device identity cannot be selected by capability dispatch", async () => {
  let dispatches = 0;
  const descriptor: WorkerDescriptor = {
    id: "phone-allowed-by-capability",
    label: "phone-allowed-by-capability",
    platform: "android",
    deviceType: "mobile",
    capabilities: ["camera"],
    executionModes: ["foreground"],
    networkRequirement: "offline-capable",
    maxParallelTasks: 1,
    enabled: true,
  };
  const worker = createFunctionWorker({
    descriptor,
    health: () => ({ connectivity: "offline" }),
    run: async () => {
      dispatches += 1;
      return "unexpected";
    },
  });
  const runtime = new DeviceCapabilityRuntime(new MultiWorkerRuntime([worker]));
  const task: TaskProfile = { id: "sec008", description: "device allowlist regression", difficulty: 1, risk: "LOW" };

  await assert.rejects(
    () => runtime.execute({
      task,
      capability: "camera",
      operation: "capture",
      preferredPlatform: "android",
      executionMode: "foreground",
      connectivity: "offline",
      allowOffline: true,
      excludedWorkerIds: [descriptor.id],
    }),
    /No healthy worker/,
  );
  assert.equal(dispatches, 0);
});
