import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("ACC-002 keeps Android task creation owner-authenticated and allowlisted", async () => {
  const broker = await source("scripts/jarvis-broker.ts");
  const adminBoundary = broker.indexOf('if (path.startsWith("/api/jarvis/admin/"))');
  const ownerGate = broker.indexOf("if (!requireOwner(request))", adminBoundary);
  const taskRoute = broker.indexOf('path === "/api/jarvis/admin/tasks"', adminBoundary);
  const validation = broker.indexOf("validatedAndroidTask(type, taskPayload)", taskRoute);

  assert.ok(adminBoundary >= 0, "admin boundary must exist");
  assert.ok(ownerGate > adminBoundary, "owner authentication must precede admin route handling");
  assert.ok(taskRoute > ownerGate, "task creation must remain behind owner authentication");
  assert.ok(validation > taskRoute, "Android task allowlisting must precede enqueue");
  assert.match(broker, /if \(!node\.id \|\| node\.kind !== "android" \|\| !Array\.isArray\(node\.capabilities\)\)/);
  assert.match(broker, /if \(node\.policy\?\.allowPaidServices !== false\)/);
  assert.match(broker, /const androidTaskCapabilities: Record<string, JarvisCapability> =/);
  assert.match(broker, /if \(!\(type in androidTaskCapabilities\)\) throw new Error/);
});

test("ACC-002 Android Worker polls and returns task results only as signed requests", async () => {
  const client = await source("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt");

  assert.match(client, /fun nextTask\(\): JSONObject = request\("POST", "\/api\/jarvis\/worker\/next", "\{\}"\.toByteArray\(\), signed = true\)/);
  assert.match(client, /return request\("POST", "\/api\/jarvis\/worker\/result", body, signed = true\)/);
  assert.match(client, /val bodySha = identity\.bodySha256\(body\)/);
  assert.match(client, /val canonical = listOf\(identity\.nodeId, timestamp, nonce, method\.uppercase\(\), path, bodySha\)\.joinToString\("\\n"\)/);
  assert.match(client, /connection\.setRequestProperty\("X-Jarvis-Signature", identity\.signCanonical\(canonical\)\)/);
});

test("ACC-002 Broker authenticates an enrolled Worker before task delivery or result application", async () => {
  const broker = await source("scripts/jarvis-broker.ts");
  const workerBoundary = broker.indexOf('if (path.startsWith("/api/jarvis/worker/"))');
  const authentication = broker.indexOf("const identity = authenticateWorker(request, path, body)", workerBoundary);
  const payloadParse = broker.indexOf("const payload = parseJson(body)", authentication);
  const nextRoute = broker.indexOf('path === "/api/jarvis/worker/next"', authentication);
  const resultRoute = broker.indexOf('path === "/api/jarvis/worker/result"', authentication);

  assert.ok(workerBoundary >= 0, "Worker route boundary must exist");
  assert.ok(authentication > workerBoundary, "Worker authentication must happen at the route boundary");
  assert.ok(payloadParse > authentication, "raw signed bytes must authenticate before JSON parsing");
  assert.ok(nextRoute > payloadParse, "task polling must remain behind Worker authentication");
  assert.ok(resultRoute > payloadParse, "task results must remain behind Worker authentication");
  assert.match(broker, /const identity = store\.getWorkerIdentity\(signed\.nodeId\); if \(!identity\) return undefined;/);
  assert.match(broker, /verifyWorkerRequest\(\{ identity, request: signed, seenNonce:/);
  assert.match(broker, /plane\.completeTask\(payload\.taskId, identity\.nodeId, detail\)/);
});

test("ACC-002 preserves Android platform-policy checks in the on-device executor", async () => {
  const executor = await source("android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt");

  assert.match(executor, /if \(!url\.startsWith\("https:\/\/"\)\)/);
  assert.match(executor, /if \(keyguard\?\.isDeviceLocked == true\) throw IllegalStateException\("Device is locked; human unlock is required"\)/);
  assert.match(executor, /if \(!dpm\.isAdminActive\(admin\)\) throw IllegalStateException\("JARVIS device admin is not active"\)/);
  assert.match(executor, /if \(!dpm\.isDeviceOwnerApp\(context\.packageName\)\) throw IllegalStateException\("Reboot requires Device Owner enrollment"\)/);
});
