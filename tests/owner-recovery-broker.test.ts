import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function unusedPort(): Promise<number> {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return port;
}

test("Broker recovery admin contract is authenticated, one-use, cancellable, and issuer-bound", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "owner-recovery-broker-"));
  const databasePath = join(directory, "broker.sqlite");
  const owner = randomBytes(32).toString("hex");
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let stderr = "";
  const start = () => {
    const process = spawn(globalThis.process.execPath, ["scripts/jarvis-broker.ts"], {
      env: { ...globalThis.process.env, JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: owner, JARVIS_DB_PATH: databasePath },
      stdio: ["ignore", "ignore", "pipe"],
    });
    process.stderr?.on("data", chunk => { stderr += String(chunk); });
    return process;
  };
  const waitReady = async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { if ((await fetch(base + "/health")).ok) return; } catch { /* bounded startup */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("Broker did not start");
  };
  const post = (path: string, body: unknown, authenticated = true) => fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${owner}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const recovery = (body: unknown, authenticated = true) => post("/api/jarvis/admin/owner-recovery", body, authenticated);
  const register = (deviceId: string, label = "Trusted iPhone") => post("/api/jarvis/admin/trusted-devices", { action: "register", deviceId, label });
  const issuer = "issuer_1234567890abcdef";
  const secondIssuer = "issuer_abcdef1234567890";
  const thumbprint = "T".repeat(43);
  const sourceBucket = "S".repeat(43);
  try {
    child = start();
    await waitReady();
    assert.equal((await recovery({ action: "issue", issuerDeviceId: issuer }, false)).status, 401);
    const malformedMarker = "OR-ABCD-EFGH-JKMN-PQRS";
    const malformed = await recovery(`{"action":"redeem","code":"${malformedMarker}"`);
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { message: "invalid owner recovery request" });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(stderr.includes(malformedMarker), false);
    assert.equal((await register(issuer)).status, 200);
    assert.equal((await register(secondIssuer)).status, 200);

    const issued = await recovery({ action: "issue", issuerDeviceId: issuer });
    assert.equal(issued.status, 201);
    assert.equal(issued.headers.get("cache-control"), "no-store");
    assert.equal(issued.headers.get("referrer-policy"), "no-referrer");
    const first = await issued.json() as { code: string; expiresAt: number };
    assert.match(first.code, /^OR-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    assert.equal(Number.isSafeInteger(first.expiresAt), true);

    assert.equal((await recovery({ action: "cancel", issuerDeviceId: secondIssuer })).status, 409);
    assert.deepEqual(await (await recovery({ action: "cancel", issuerDeviceId: issuer })).json(), { cancelled: true });
    assert.deepEqual(await (await recovery({ action: "cancel", issuerDeviceId: issuer })).json(), { cancelled: false });

    const next = await (await recovery({ action: "issue", issuerDeviceId: issuer })).json() as { code: string };
    const redemption = await recovery({ action: "redeem", code: next.code, deviceId: "target_1234567890abcdef", label: "New iPhone", publicKeyThumbprint: thumbprint, sourceBucket });
    assert.equal(redemption.status, 200);
    assert.deepEqual(await redemption.json(), { device: { deviceId: "target_1234567890abcdef", label: "New iPhone", revoked: false } });
    assert.equal((await recovery({ action: "redeem", code: next.code, deviceId: "target_abcdef1234567890", label: "Replay", publicKeyThumbprint: thumbprint, sourceBucket })).status, 409);

    const revokedCode = await (await recovery({ action: "issue", issuerDeviceId: issuer })).json() as { code: string };
    assert.equal((await post("/api/jarvis/admin/trusted-devices", { action: "revoke", deviceId: issuer })).status, 200);
    assert.equal((await recovery({ action: "redeem", code: revokedCode.code, deviceId: "target_deadbeef12345678", label: "Denied", publicKeyThumbprint: thumbprint, sourceBucket })).status, 409);

    const racing = await (await recovery({ action: "issue", issuerDeviceId: secondIssuer })).json() as { code: string };
    const results = await Promise.all([
      recovery({ action: "redeem", code: racing.code, deviceId: "target_race00000000001", label: "Race one", publicKeyThumbprint: thumbprint, sourceBucket }),
      recovery({ action: "redeem", code: racing.code, deviceId: "target_race00000000002", label: "Race two", publicKeyThumbprint: thumbprint, sourceBucket }),
    ]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);

    assert.equal((await recovery({ action: "unknown", code: first.code })).status, 400);
    assert.equal((await recovery({ action: "unknown", padding: "x".repeat(5000) })).status, 400);
    const persisted = await readFile(databasePath + ".trusted-devices.json", "utf8");
    assert.equal(persisted.includes(first.code), false);
    assert.equal(persisted.includes(next.code), false);
    assert.equal(persisted.includes(racing.code), false);

    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
    child = undefined;
    await writeFile(databasePath + ".trusted-devices.json", "{corrupt", "utf8");
    child = start();
    await waitReady();
    assert.equal((await recovery({ action: "issue", issuerDeviceId: secondIssuer })).status, 503);
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
