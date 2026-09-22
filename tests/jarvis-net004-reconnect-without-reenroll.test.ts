import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  JarvisFleetManager,
  type JarvisNode,
  type JarvisTask,
} from "../src/jarvis/index.ts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function enrolledAndroidNode(): JarvisNode {
  return {
    id: "android-reconnect-001",
    label: "android-reconnect-001",
    kind: "android",
    status: "ready",
    capabilities: ["background-worker"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: {
      batteryPercent: 80,
      charging: true,
      network: "wifi",
      checkedAt: "2026-09-22T10:00:00.000Z",
    },
    enrollment: "full",
    fleetNumber: 1,
    lastSeenAt: "2026-09-22T10:00:00.000Z",
  };
}

function reconnectTask(nodeId: string): JarvisTask {
  return {
    id: "task-reconnect-001",
    idempotencyKey: "net004-reconnect-001",
    type: "reconnect-regression",
    payload: {},
    status: "queued",
    requiredCapabilities: ["background-worker"],
    priority: "normal",
    requiresOnline: true,
    targetNodeId: nodeId,
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
  };
}

test("NET-004 reconnects the same enrolled fleet identity without consuming another slot", () => {
  const fleet = new JarvisFleetManager();
  const node = enrolledAndroidNode();
  const task = reconnectTask(node.id);

  fleet.register(node);
  assert.equal(fleet.list().length, 1);
  assert.equal(fleet.select(task)?.id, node.id);

  fleet.updateHeartbeat(node.id, {
    status: "offline",
    telemetry: {
      network: "offline",
      checkedAt: "2026-09-22T10:01:00.000Z",
    },
    lastSeenAt: "2026-09-22T10:01:00.000Z",
  });
  assert.equal(fleet.list().length, 1);
  assert.equal(fleet.select(task), undefined);

  fleet.updateHeartbeat(node.id, {
    status: "ready",
    telemetry: {
      network: "wifi",
      checkedAt: "2026-09-22T10:02:00.000Z",
    },
    lastSeenAt: "2026-09-22T10:02:00.000Z",
  });

  const recovered = fleet.get(node.id);
  assert.equal(fleet.list().length, 1);
  assert.equal(recovered?.id, node.id);
  assert.equal(recovered?.enrollment, "full");
  assert.equal(recovered?.fleetNumber, 1);
  assert.equal(recovered?.telemetry.network, "wifi");
  assert.equal(fleet.select(task)?.id, node.id);
});

test("NET-004 Android retry path preserves identity and never re-enrolls after transport failure", () => {
  const identity = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/DeviceIdentity.kt");
  const broker = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt");
  const pollWorker = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisPollWorker.kt");
  const mainActivity = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/MainActivity.kt");

  assert.match(identity, /getSharedPreferences\("jarvis_identity", Context\.MODE_PRIVATE\)/);
  assert.match(identity, /prefs\.getString\("node_id", null\)/);
  assert.match(identity, /KeyStore\.getInstance\("AndroidKeyStore"\)/);
  assert.match(identity, /if \(keyStore\.containsAlias\(alias\)\) return/);

  assert.match(broker, /getSharedPreferences\("jarvis_config", Context\.MODE_PRIVATE\)/);
  assert.match(broker, /putString\("broker_url", value\.trimEnd\('\/'\)\)/);
  assert.match(broker, /fun heartbeat\(\): JSONObject/);
  assert.match(broker, /"\/api\/jarvis\/worker\/heartbeat", body, signed = true/);

  assert.match(pollWorker, /getOrElse \{ Result\.retry\(\) \}/);
  assert.doesNotMatch(pollWorker, /\.enroll(?:Grant|FromPairingWindow)?\(/);
  assert.doesNotMatch(pollWorker, /requestOwnerRegistration\(/);

  assert.match(mainActivity, /Network failures and previously registered identities must never mint grants\./);
  assert.match(mainActivity, /error\.statusCode != 401 \|\| prefs\.getBoolean\("enrollment_verified", false\)/);
  assert.match(mainActivity, /require\(!verified\) \{ "登録済み端末の認証を確認できません。再登録せず所有者へ確認してください" \}/);
  assert.match(mainActivity, /ExistingPeriodicWorkPolicy\.KEEP/);
  assert.match(mainActivity, /setRequiredNetworkType\(NetworkType\.CONNECTED\)/);
});
