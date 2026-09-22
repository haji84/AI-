import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JarvisTaskQueue } from "../src/jarvis/task-queue.ts";
import type { JarvisTask } from "../src/jarvis/types.ts";
import {
  inspectPrivateIngress,
  tailscaleBackendIsRunning,
} from "../scripts/jarvis-remote-access-lib.mjs";

const serviceSource = readFileSync(
  "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt",
  "utf8",
);
const bootSource = readFileSync(
  "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BootReceiver.kt",
  "utf8",
);
const clientSource = readFileSync(
  "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt",
  "utf8",
);
const identitySource = readFileSync(
  "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/DeviceIdentity.kt",
  "utf8",
);

function task(id: string): JarvisTask {
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
    targetNodeId: "android-net004",
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
  };
}

function privateServeConfig() {
  return {
    TCP: { "443": { HTTPS: true } },
    Web: {
      "jarvis-host.example.ts.net:443": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } },
      },
    },
  };
}

test("NET-004 transient Broker/network failure keeps the existing signed polling path and never re-enrolls", () => {
  assert.match(serviceSource, /return START_STICKY/);
  assert.match(serviceSource, /while \(running\.get\(\)\)/);
  assert.match(serviceSource, /client\.heartbeat\(\)/);
  assert.match(serviceSource, /client\.nextTask\(\)/);
  assert.match(
    serviceSource,
    /catch \(_: Throwable\) \{\s*\/\/ Keep the foreground service alive across temporary network\/Broker failures\./,
  );

  for (const forbidden of ["enrollFromPairingWindow", ".enroll(", ".enrollGrant("]) {
    assert.equal(serviceSource.includes(forbidden), false, `polling service must not call ${forbidden}`);
  }

  assert.match(clientSource, /fun nextTask\(\): JSONObject = request\("POST", "\/api\/jarvis\/worker\/next", "\{\}"\.toByteArray\(\), signed = true\)/);
  assert.match(clientSource, /connection\.setRequestProperty\("X-Jarvis-Node-Id", identity\.nodeId\)/);
  assert.match(clientSource, /connection\.setRequestProperty\("X-Jarvis-Signature", identity\.signCanonical\(canonical\)\)/);
});

test("NET-004 boot/package replacement restarts the Worker and fallback without invoking enrollment", () => {
  assert.match(bootSource, /Intent\.ACTION_BOOT_COMPLETED/);
  assert.match(bootSource, /Intent\.ACTION_MY_PACKAGE_REPLACED/);
  assert.match(bootSource, /JarvisCommandService\.start\(context\)/);
  assert.match(bootSource, /setRequiredNetworkType\(NetworkType\.CONNECTED\)/);
  assert.match(bootSource, /enqueueUniquePeriodicWork/);
  assert.doesNotMatch(bootSource, /enrollFromPairingWindow|\.enroll\(|\.enrollGrant\(/);
});

test("NET-004 reconnect preserves Broker address, node identity and signing-key identity", () => {
  assert.match(clientSource, /getSharedPreferences\("jarvis_config", Context\.MODE_PRIVATE\)/);
  assert.match(clientSource, /prefs\.getString\("broker_url", ""\)/);
  assert.match(clientSource, /putString\("broker_url", value\.trimEnd\('\/'\)\)/);

  assert.match(identitySource, /getSharedPreferences\("jarvis_identity", Context\.MODE_PRIVATE\)/);
  assert.match(identitySource, /prefs\.getString\("node_id", null\) \?: UUID\.randomUUID\(\)\.toString\(\)\.also/);
  assert.match(identitySource, /putString\("node_id", it\)/);
  assert.match(identitySource, /private val alias = "jarvis_worker_signing_key"/);
  assert.match(identitySource, /KeyStore\.getInstance\("AndroidKeyStore"\)/);
});

test("NET-004 interrupted leased work becomes resumable by the same persistent node after reconnect", () => {
  const queue = new JarvisTaskQueue();
  const disconnectedAt = new Date("2026-09-22T10:00:00.000Z");
  const reconnectedAt = new Date("2026-09-22T10:00:02.000Z");

  queue.enqueue(task("net004-resume"));
  queue.lease("net004-resume", "android-net004", 1_000, disconnectedAt);
  queue.markRunning("net004-resume", new Date(disconnectedAt.getTime() + 100));

  const recovered = queue.next(reconnectedAt);
  assert.equal(recovered?.status, "queued");
  assert.equal(recovered?.assignedNodeId, undefined);
  assert.equal(recovered?.attempts, 1);

  const resumed = queue.lease("net004-resume", "android-net004", 1_000, reconnectedAt);
  assert.equal(resumed.assignedNodeId, "android-net004");
  queue.markRunning("net004-resume", new Date(reconnectedAt.getTime() + 100));
  assert.equal(queue.complete("net004-resume", new Date(reconnectedAt.getTime() + 200)).status, "completed");
});

test("NET-004 network recovery never converts unsafe ingress into ready state", () => {
  assert.equal(tailscaleBackendIsRunning({ BackendState: "Stopped" }), false);
  assert.equal(tailscaleBackendIsRunning({ BackendState: "Running" }), true);

  const privateConfig = privateServeConfig();
  const recovered = inspectPrivateIngress(JSON.stringify(privateConfig), {
    dnsName: "jarvis-host.example.ts.net",
  });
  assert.equal(recovered.ready, true);
  assert.equal(recovered.state, "private");

  const funnel = { ...privateConfig, AllowFunnel: { "jarvis-host.example.ts.net:443": true } };
  assert.equal(inspectPrivateIngress(JSON.stringify(funnel)).ready, false);

  const protectedProxy = privateServeConfig();
  protectedProxy.Web["jarvis-host.example.ts.net:443"].Handlers["/broker"] = {
    Proxy: "http://127.0.0.1:8787",
  };
  const refused = inspectPrivateIngress(JSON.stringify(protectedProxy), {
    dnsName: "jarvis-host.example.ts.net",
  });
  assert.equal(refused.ready, false);
  assert.match(refused.reason, /Protected backend exposed directly/);
});
