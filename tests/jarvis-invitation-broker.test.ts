import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { canonicalWorkerRequest } from "../src/jarvis/worker-auth.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("owner invitation enrolls while window is closed, persists restart and revokes", { timeout: 30_000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const directory = await mkdtemp(join(tmpdir(), "jarvis-invite-broker-"));
  const owner = randomBytes(32).toString("hex");
  const start = () => spawn(process.execPath, ["scripts/jarvis-broker.ts"], { env: { ...process.env,
    JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: owner,
    JARVIS_PUBLIC_BROKER_URL: "https://192.168.0.169:8792", JARVIS_DB_PATH: join(directory, "broker.sqlite") }, stdio: "ignore" });
  let child = start();
  const base = `http://127.0.0.1:${port}`;
  const waitReady = async () => {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + "/health")).ok) return; } catch { /* bounded startup */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("Broker did not start");
  };
  const stop = async () => { const exited = once(child, "exit"); child.kill(); await exited; };
  const post = (path: string, body: unknown, auth = false) => fetch(base + path, { method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${owner}` } : {}) }, body: JSON.stringify(body) });
  try {
    await waitReady();
    const path = "/api/jarvis/admin/invitation";
    assert.equal((await post(path, { action: "create" })).status, 401);
    const issued = await post(path, { action: "create", maxDevices: 100 }, true);
    assert.equal(issued.status, 201);
    const link = new URL((await issued.json()).url);
    const token = new URLSearchParams(link.hash.slice(1)).get("token");
    assert.ok(token);
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const signedRequest = (id: string, path: string, payload: unknown) => {
      const body = JSON.stringify(payload);
      const unsigned = { nodeId: id, method: "POST", path, timestamp: new Date().toISOString(), nonce: randomBytes(16).toString("hex"), bodySha256: createHash("sha256").update(body).digest("hex") };
      return { method: "POST", body, headers: { "Content-Type": "application/json", "X-Jarvis-Node-Id": id, "X-Jarvis-Timestamp": unsigned.timestamp, "X-Jarvis-Nonce": unsigned.nonce, "X-Jarvis-Body-Sha256": unsigned.bodySha256, "X-Jarvis-Signature": sign("sha256", Buffer.from(canonicalWorkerRequest(unsigned)), keys.privateKey).toString("base64") } };
    };
    const enroll = (id: string) => post("/api/jarvis/enroll", { token,
      node: { id, label: "Fixture Android", kind: "android", status: "ready", capabilities: ["open-url"],
        policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
        telemetry: { checkedAt: new Date().toISOString() }, enrollment: "quick", lastSeenAt: new Date().toISOString() },
      identity: { algorithm: "ecdsa-p256-sha256", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }) } });
    assert.equal((await post("/api/jarvis/enrollment-grant", {})).status, 503);
    assert.equal((await enroll("invite-first")).status, 201);
    assert.equal((await enroll("invite-first")).status, 409);
    const heartbeatPath = "/api/jarvis/worker/heartbeat";
    assert.equal((await fetch(base + heartbeatPath, signedRequest("invite-first", heartbeatPath, { status: "ready", capabilities: ["ui-automation", "remote-view", "remote-control"], telemetry: { checkedAt: new Date().toISOString(), accessibilityEnabled: true, remoteProtocol: 1, androidApi: 30, locked: false } }))).status, 200);
    const commandPath = "/api/jarvis/admin/remote/command";
    const commandInput = { nodeId: "invite-first", sessionId: "fixture-session", expiresAt: Date.now() + 5_000, input: { action: "tap", x: 10, y: 20 } };
    assert.equal((await post(commandPath, commandInput)).status, 401);
    const remoteResult = post(commandPath, commandInput, true);
    const nextPath = "/api/jarvis/worker/remote/next";
    assert.equal((await post(nextPath, {})).status, 401);
    let command: { id: string; input: unknown } | undefined;
    for (let attempt = 0; attempt < 20 && !command; attempt++) {
      command = (await (await fetch(base + nextPath, signedRequest("invite-first", nextPath, {}))).json()).command;
      if (!command) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(command);
    assert.deepEqual(command.input, commandInput.input);
    assert.equal((await (await fetch(base + nextPath, signedRequest("invite-first", nextPath, {}))).json()).command, null);
    const resultPath = "/api/jarvis/worker/remote/result";
    const signedResult = signedRequest("invite-first", resultPath, { id: command.id, ok: true });
    assert.equal((await fetch(base + resultPath, signedResult)).status, 200);
    assert.equal((await remoteResult).status, 200);
    assert.equal((await fetch(base + resultPath, signedResult)).status, 401, "replayed nonce rejected");
    assert.equal((await fetch(base + resultPath, signedRequest("invite-first", resultPath, { id: command.id, ok: true }))).status, 409, "finished command rejected even with fresh signature");
    await stop(); child = start(); await waitReady();
    assert.equal((await enroll("invite-second")).status, 201);
    assert.equal((await post(path, { action: "revoke" }, true)).status, 200);
    assert.equal((await enroll("invite-third")).status, 403);
    assert.equal((await (await fetch(base + "/health")).json()).stats.registered, 2);
    assert.equal((await post("/api/jarvis/worker/heartbeat", {})).status, 401);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
