import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { generateKeyPairSync, randomBytes } from "node:crypto";
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
    const enroll = (id: string) => post("/api/jarvis/enroll", { token,
      node: { id, label: "Fixture Android", kind: "android", status: "ready", capabilities: ["open-url"],
        policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
        telemetry: { checkedAt: new Date().toISOString() }, enrollment: "quick", lastSeenAt: new Date().toISOString() },
      identity: { algorithm: "ecdsa-p256-sha256", publicKeyPem: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }) } });
    assert.equal((await post("/api/jarvis/enrollment-grant", {})).status, 503);
    assert.equal((await enroll("invite-first")).status, 201);
    assert.equal((await enroll("invite-first")).status, 409);
    await stop(); child = start(); await waitReady();
    assert.equal((await enroll("invite-second")).status, 201);
    assert.equal((await post(path, { action: "revoke" }, true)).status, 200);
    assert.equal((await enroll("invite-third")).status, 403);
    assert.equal((await (await fetch(base + "/health")).json()).stats.registered, 2);
    assert.equal((await post("/api/jarvis/worker/heartbeat", {})).status, 401);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
