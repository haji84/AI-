import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("launch enrollment reuses owner window and single-use grants without leaking owner credentials", { timeout: 30_000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const directory = await mkdtemp(join(tmpdir(), "jarvis-launch-"));
  const owner = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, ["scripts/jarvis-broker.ts"], {
    env: { ...process.env, JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port),
      JARVIS_OWNER_TOKEN: owner, JARVIS_PUBLIC_BROKER_URL: "https://jarvis.example.invalid",
      JARVIS_DB_PATH: join(directory, "broker.sqlite") }, stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown = {}, authenticated = false) => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${owner}` } : {}) }, body: JSON.stringify(body),
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { ready = (await fetch(base + "/health")).ok; } catch { /* bounded startup wait */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "test broker started");
    assert.equal((await post("/api/jarvis/enrollment-grant")).status, 503);
    assert.equal((await post("/api/jarvis/admin/enrollment-window", { action: "open" })).status, 401);
    assert.equal((await post("/api/jarvis/admin/enrollment-window", { action: "open", maxIssues: 2 }, true)).status, 200);
    const issued = await post("/api/jarvis/enrollment-grant");
    assert.equal(issued.status, 201);
    assert.equal(issued.headers.get("cache-control"), "no-store");
    const grant = await issued.json();
    assert.deepEqual(Object.keys(grant).sort(), ["expiresAt", "grant"]);
    assert(!JSON.stringify(grant).includes(owner));
    assert(Date.parse(grant.expiresAt) - Date.now() <= 600_000);
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const payload = {
      grant: grant.grant,
      node: { id: "launch-test-1", label: "Test", kind: "android", status: "ready", capabilities: ["open-url"],
        policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
        telemetry: { checkedAt: new Date().toISOString() }, enrollment: "quick", lastSeenAt: new Date().toISOString() },
      identity: { algorithm: "ecdsa-p256-sha256", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) },
    };
    assert.equal((await post("/api/jarvis/enroll", payload)).status, 201);
    assert.equal((await post("/api/jarvis/worker/heartbeat", {})).status, 401, "enrollment does not bypass worker signing");
    const heartbeatPath = "/api/jarvis/worker/heartbeat";
    const timestamp = new Date().toISOString();
    const nonce = randomBytes(20).toString("hex");
    const hash = createHash("sha256").update("{}").digest("hex");
    const signature = sign("sha256", Buffer.from([payload.node.id, timestamp, nonce, "POST", heartbeatPath, hash].join("\n")), privateKey).toString("base64");
    const heartbeat = () => fetch(base + heartbeatPath, { method: "POST", body: "{}", headers: {
      "Content-Type": "application/json", "X-Jarvis-Node-Id": payload.node.id,
      "X-Jarvis-Timestamp": timestamp, "X-Jarvis-Nonce": nonce, "X-Jarvis-Body-Sha256": hash,
      "X-Jarvis-Signature": signature,
    } });
    assert.equal((await heartbeat()).status, 200, "newly enrolled identity authenticates");
    assert.equal((await heartbeat()).status, 401, "signed heartbeat replay rejected");
    assert.notEqual((await post("/api/jarvis/enroll", { ...payload, node: { ...payload.node, id: "launch-test-2" } })).status, 201);
    assert.equal((await post("/api/jarvis/enrollment-grant")).status, 201);
    assert.equal((await post("/api/jarvis/enrollment-grant")).status, 503, "budget exhausted");
    await post("/api/jarvis/admin/enrollment-window", { action: "close" }, true);
    assert.equal((await post("/api/jarvis/enrollment-grant")).status, 503);
  } finally {
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
    await rm(directory, { recursive: true, force: true });
  }
});
