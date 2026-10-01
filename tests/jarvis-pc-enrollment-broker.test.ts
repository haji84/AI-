import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import { JarvisControlPlane } from "../src/jarvis/control-plane.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { canonicalWorkerRequest } from "../src/jarvis/worker-auth.ts";

test("Owner PC proof enrollment preserves signed identity across restart and rejects escalation", { timeout: 30_000 }, async () => {
  const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const dir = await mkdtemp(join(tmpdir(), "pc-broker-")), db = join(dir, "state.sqlite");
  const seed = new JarvisSqliteStateStore(db), plane = new JarvisControlPlane();
  const enrollment = plane.createEnrollment({ mode: "fleet", maxDevices: 38 });
  for (let n = 0; n < 38; n++) {
    const id = `android-fixture-${n}`;
    plane.enroll(enrollment.token, { id, label: id, kind: "android", status: "offline", capabilities: ["open-url"],
      policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
      telemetry: { checkedAt: new Date().toISOString() }, enrollment: "quick", lastSeenAt: new Date().toISOString() });
    seed.saveWorkerIdentity({ nodeId: id, publicKeyPem: "original-public-fixture", enrolledAt: new Date().toISOString() });
  }
  seed.save(plane.snapshot()); seed.close();
  const owner = randomUUID(), base = `http://127.0.0.1:${port}`;
  const start = () => spawn(process.execPath, ["scripts/jarvis-broker.ts"], { stdio: "ignore", env: { ...process.env,
    GITHUB_TOKEN: "", JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: owner,
    JARVIS_DB_PATH: db, JARVIS_COMPASS_DB_PATH: join(dir, "compass.sqlite"), JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" } });
  let child = start();
  const ready = async () => { for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/health")).ok) return; } catch { /* bounded startup */ }
    await new Promise(r => setTimeout(r, 50)); } assert.fail("Broker startup unavailable"); };
  const stop = async () => { const done = once(child, "exit"); child.kill(); await done; };
  const post = (path: string, input: unknown, auth = true) => fetch(base + path, { method: "POST", headers: {
    "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${owner}` } : {}) }, body: JSON.stringify(input) });
  const keys = generateKeyPairSync("ed25519");
  const input = { nodeId: "macbook", platform: "macos", algorithm: "ed25519", publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString() };
  const signed = (payload: unknown) => {
    const body = JSON.stringify(payload), path = "/api/jarvis/worker/heartbeat";
    const unsigned = { nodeId: "macbook", path, method: "POST", timestamp: new Date().toISOString(), nonce: randomUUID(), bodySha256: createHash("sha256").update(body).digest("hex") };
    return { method: "POST", body, headers: { "Content-Type": "application/json", "X-Jarvis-Node-Id": unsigned.nodeId,
      "X-Jarvis-Timestamp": unsigned.timestamp, "X-Jarvis-Nonce": unsigned.nonce, "X-Jarvis-Body-Sha256": unsigned.bodySha256,
      "X-Jarvis-Signature": sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), keys.privateKey).toString("base64") } };
  };
  try {
    await ready();
    const grant = await (await post("/api/jarvis/admin/enrollment", { mode: "quick" })).json();
    const forgedAndroid = { id: "android-forged", label: "Android", kind: "android", capabilities: ["open-url"],
      policy: { allowPaidServices: false }, pcAuthority: { version: 1, approvalIssue: 1662, goalIssue: 1219,
        roles: ["Coordinator"], capabilityCeiling: ["remote-control"] } };
    assert.equal((await post("/api/jarvis/enroll", { token: grant.token.token, node: forgedAndroid,
      identity: { publicKeyPem: input.publicKeyPem, algorithm: "ed25519" } }, false)).status, 400);
    assert.equal((await post("/api/jarvis/enrollment-request", { node: forgedAndroid,
      publicKeyPem: input.publicKeyPem, algorithm: "ed25519" }, false)).status, 400);
    const challengePath = "/api/jarvis/admin/pc-enrollment/challenge";
    assert.equal((await post(challengePath, input, false)).status, 401);
    assert.equal((await post(challengePath, input)).status, 409, "no local approval fails closed");
    const now = Date.now();
    await writeFile(db + ".pc-enrollment-approval.json", JSON.stringify({ version: 1, issue: 1662, goalIssue: 1219,
      approvedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(),
      targets: [{ nodeId: "macbook", platform: "macos" }], roles: ["Executor", "Storage", "Verifier", "Coordinator"] }), { mode: 0o600 });
    const response = await post(challengePath, input);
    assert.equal(response.status, 201);
    const challenge = await response.json();
    const proof = { challengeId: challenge.challengeId, signatureBase64: sign(null, Buffer.from(challenge.proofText), keys.privateKey).toString("base64") };
    const proven = await post("/api/jarvis/admin/pc-enrollment/prove", proof);
    assert.equal(proven.status, 201);
    assert.equal((await proven.json()).node.kind, "macos");
    assert.equal((await post(challengePath, input)).status, 409);
    assert.equal((await post("/api/jarvis/admin/pc-enrollment/prove", proof)).status, 409);
    const heartbeat = signed({ capabilities: ["filesystem"], status: "ready" });
    assert.equal((await fetch(base + "/api/jarvis/worker/heartbeat", heartbeat)).status, 200);
    assert.equal((await fetch(base + "/api/jarvis/worker/heartbeat", heartbeat)).status, 401);
    assert.equal((await fetch(base + "/api/jarvis/worker/heartbeat", signed({ capabilities: ["remote-control"] }))).status, 403);
    await stop(); child = start(); await ready();
    const resumed = await fetch(base + "/api/jarvis/worker/heartbeat", signed({ status: "ready" }));
    assert.equal(resumed.status, 200);
    assert.deepEqual((await resumed.json()).node.capabilities, ["filesystem"]);
    await stop();
    const persisted = new JarvisSqliteStateStore(db);
    try {
      assert.equal(persisted.load()?.fleet.filter(n => n.kind === "android").length, 38);
      assert.equal(persisted.listWorkerIdentities().length, 39);
      for (let n = 0; n < 38; n++) assert.equal(persisted.getWorkerIdentity(`android-fixture-${n}`)?.publicKeyPem, "original-public-fixture");
    } finally { persisted.close(); }
  } finally { if (child.exitCode === null) await stop(); await rm(dir, { recursive: true, force: true }); }
});
