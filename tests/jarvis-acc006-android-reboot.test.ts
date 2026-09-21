import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("ACC-006 manifest keeps the boot receiver private and boot-complete capable", () => {
  const manifest = read("android/jarvis-worker/app/src/main/AndroidManifest.xml");

  assert.match(manifest, /<uses-permission android:name="android\.permission\.RECEIVE_BOOT_COMPLETED" \/>/);
  assert.match(manifest, /<receiver[\s\S]*android:name="\.BootReceiver"[\s\S]*android:exported="false"[\s\S]*android\.intent\.action\.BOOT_COMPLETED[\s\S]*android\.intent\.action\.MY_PACKAGE_REPLACED[\s\S]*<\/receiver>/);
});

test("ACC-006 boot handling restarts polling and installs a unique network fallback", () => {
  const receiver = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BootReceiver.kt");

  assert.match(receiver, /action != Intent\.ACTION_BOOT_COMPLETED && action != Intent\.ACTION_MY_PACKAGE_REPLACED/);
  assert.match(receiver, /runCatching \{ JarvisCommandService\.start\(context\) \}/);
  assert.match(receiver, /PeriodicWorkRequestBuilder<JarvisPollWorker>\(15, TimeUnit\.MINUTES\)/);
  assert.match(receiver, /setRequiredNetworkType\(NetworkType\.CONNECTED\)/);
  assert.match(receiver, /enqueueUniquePeriodicWork\([\s\S]*"jarvis-worker-fallback"[\s\S]*ExistingPeriodicWorkPolicy\.KEEP/);
  assert.doesNotMatch(receiver, /enrollFromPairingWindow|\.enroll\(|\.enrollGrant\(/);
});

test("ACC-006 foreground worker is sticky and fail-open only for temporary transport failures, not enrollment", () => {
  const service = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt");

  assert.match(service, /return START_STICKY/);
  assert.match(service, /while \(running\.get\(\)\)/);
  assert.match(service, /client\.heartbeat\(\)/);
  assert.match(service, /client\.nextTask\(\)/);
  assert.match(service, /Keep the foreground service alive across temporary network\/Broker failures/);
  assert.doesNotMatch(service, /enrollFromPairingWindow|\.enroll\(|\.enrollGrant\(/);
});

test("ACC-006 reboot reuses persisted broker, node identity and AndroidKeyStore signing key", () => {
  const client = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt");
  const identity = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/DeviceIdentity.kt");

  assert.match(client, /getSharedPreferences\("jarvis_config", Context\.MODE_PRIVATE\)/);
  assert.match(client, /prefs\.getString\("broker_url", ""\)/);
  assert.match(identity, /getSharedPreferences\("jarvis_identity", Context\.MODE_PRIVATE\)/);
  assert.match(identity, /prefs\.getString\("node_id", null\) \?: UUID\.randomUUID\(\)\.toString\(\)\.also/);
  assert.match(identity, /KeyStore\.getInstance\("AndroidKeyStore"\)/);
  assert.match(identity, /private val alias = "jarvis_worker_signing_key"/);
  assert.match(client, /connection\.setRequestProperty\("X-Jarvis-Node-Id", identity\.nodeId\)/);
  assert.match(client, /connection\.setRequestProperty\("X-Jarvis-Signature", identity\.signCanonical\(canonical\)\)/);
});

test("ACC-006 WorkManager fallback uses the existing signed Broker path and retries safely", () => {
  const fallback = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisPollWorker.kt");
  const client = read("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt");

  assert.match(fallback, /val client = BrokerClient\(applicationContext\)/);
  assert.match(fallback, /if \(client\.brokerUrl\.isBlank\(\)\) return Result\.success\(\)/);
  assert.match(fallback, /client\.heartbeat\(\)/);
  assert.match(fallback, /client\.nextTask\(\)/);
  assert.match(fallback, /getOrElse \{ Result\.retry\(\) \}/);
  assert.doesNotMatch(fallback, /enrollFromPairingWindow|\.enroll\(|\.enrollGrant\(/);
  assert.match(client, /fun heartbeat\(\): JSONObject[\s\S]*request\("POST", "\/api\/jarvis\/worker\/heartbeat", body, signed = true\)/);
  assert.match(client, /fun nextTask\(\): JSONObject = request\("POST", "\/api\/jarvis\/worker\/next", "\{\}"\.toByteArray\(\), signed = true\)/);
});
