import * as pcBootstrap from "../src/jarvis/pc-bootstrap.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { privateWorkerHandler } from "../src/jarvis/private-worker-ingress.ts";
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
    GORIQ_RUNTIME_REVISION: "a".repeat(40), GITHUB_TOKEN: "", JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: owner,
    JARVIS_DB_PATH: db, JARVIS_COMPASS_DB_PATH: join(dir, "compass.sqlite"), JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" } });
  let child = start();
  // Loopback transport fixture exercises the real allowlist/header relay and Broker auth.
  // Certificate/hostname verification is covered separately by the TLS ingress fixture.
  const ingress = httpServer(privateWorkerHandler(port));
  ingress.listen(0, "127.0.0.1");
  await once(ingress, "listening");
  const workerBase = `http://127.0.0.1:${(ingress.address() as { port: number }).port}`;
  const ready = async () => { for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/health")).ok) return; } catch { /* bounded startup */ }
    await new Promise(r => setTimeout(r, 50)); } assert.fail("Broker startup unavailable"); };
  const stop = async () => { const done = once(child, "exit"); child.kill(); await done; };
  const post = (path: string, input: unknown, auth = true) => fetch(base + path, { method: "POST", headers: {
    "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${owner}` } : {}) }, body: JSON.stringify(input) });
  const keys = generateKeyPairSync("ed25519");
  const input = { nodeId: "macbook", platform: "macos", algorithm: "ed25519", publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString() };
  const signed = (payload: unknown, path = "/api/jarvis/worker/heartbeat") => {
    const body = JSON.stringify(payload);
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

    const capsule = { goal: "#1219", currentJob: "#1662 registered PC execution", why: "Verify signed filesystem work",
      workflowPosition: "PC registration -> task execution", inputs: ["public text"], constraints: ["filesystem only", "no secret inputs"],
      decisions: ["restartable digest"], dependencies: ["registered PC identity"], expectedOutput: ["SHA256 and byte count"],
      definitionOfDone: ["signed result verified"], verificationContract: "Broker recomputes expected digest", recoveryContext: ["reject stale claim"] };
    const work = { idempotencyKey: "public-digest-1", goalIssue: 1219, targetNodeId: "macbook", privacyClass: "PUBLIC",
      content: "GORIQ public filesystem execution\\n", capsule };
    assert.equal((await post("/api/jarvis/admin/pc-tasks", work, false)).status, 401);
    assert.equal((await post("/api/jarvis/admin/pc-tasks", { ...work, capsule: undefined })).status, 400);
    const dispatched = await post("/api/jarvis/admin/pc-tasks", work);
    assert.equal(dispatched.status, 201, "registered filesystem PC must accept scoped durable work");
    const durable = (await dispatched.json()).task;
    const duplicate = await post("/api/jarvis/admin/pc-tasks", work);
    assert.equal((await duplicate.json()).task.id, durable.id);
    assert.equal((await post("/api/jarvis/admin/pc-tasks", { ...work, content: "changed input" })).status, 409);
    const nextPath = "/api/jarvis/worker/pc/next";
    assert.equal((await fetch(workerBase + nextPath, { method: "POST", body: "{}",
      headers: { Authorization: `Bearer ${owner}`, Cookie: "owner-session" } })).status, 401,
      "private ingress must not turn Owner credentials into worker authority");
    const unknown = signed({}, nextPath);
    unknown.headers["X-Jarvis-Node-Id"] = "unregistered-pc";
    assert.equal((await fetch(workerBase + nextPath, unknown)).status, 401);
    const tampered = signed({}, nextPath);
    tampered.body = '{"taskId":"tampered"}';
    assert.equal((await fetch(workerBase + nextPath, tampered)).status, 401);
    assert.equal((await fetch(workerBase + "/api/jarvis/admin/pc-tasks", { method: "POST", body: "{}",
      headers: { Authorization: `Bearer ${owner}` } })).status, 404);
    const unrelated = await fetch(workerBase + "/api/jarvis/worker/pc/next", signed({ taskId: "pc-unrelated" }, "/api/jarvis/worker/pc/next"));
    assert.equal((await unrelated.json()).task, null, "bounded client must not claim an unrelated task");
    const next = await fetch(workerBase + "/api/jarvis/worker/pc/next", signed({ taskId: durable.id }, "/api/jarvis/worker/pc/next"));
    assert.equal(next.status, 200);
    const assignment = await next.json();
    assert.equal(assignment.task.id, durable.id);
    assert.equal(assignment.claim.owner, "macbook");
    const result = { taskId: durable.id, claim: assignment.claim, detail: {
      sha256: createHash("sha256").update(work.content).digest("hex"), bytes: Buffer.byteLength(work.content) } };
    assert.equal((await fetch(workerBase + "/api/jarvis/worker/pc/result",
      signed({ ...result, claim: { ...assignment.claim, epoch: assignment.claim.epoch + 1 } }, "/api/jarvis/worker/pc/result"))).status, 409);
    const resultRequest = signed(result, "/api/jarvis/worker/pc/result");
    const returned = await fetch(workerBase + "/api/jarvis/worker/pc/result", resultRequest);
    assert.equal(returned.status, 200);
    assert.equal((await returned.json()).task.status, "completed");
    assert.equal((await fetch(workerBase + "/api/jarvis/worker/pc/result", resultRequest)).status, 401,
      "identical signed result replay must fail through ingress");
    assert.equal((await fetch(workerBase + "/api/jarvis/worker/pc/result", signed(result, "/api/jarvis/worker/pc/result"))).status, 409);

    assert.equal(typeof pcBootstrap.executeLocalPcWork, "function", "registered PC requires a signed filesystem execution client");
    const clientWork = { ...work, idempotencyKey: "public-digest-client", content: "Actual file-backed public work" };
    const clientSubmitted = await post("/api/jarvis/admin/pc-tasks", clientWork);
    assert.equal(clientSubmitted.status, 201);
    const clientTaskId = (await clientSubmitted.json()).task.id;
    const local = { version: 1 as const, nodeId: "macbook", platform: "macos" as const, algorithm: "ed25519" as const,
      hostBinding: "fixture", createdAt: new Date().toISOString(), publicKeyPem: input.publicKeyPem,
      privateKeyPem: keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
    const execution = await pcBootstrap.executeLocalPcWork({ base, revision: "a".repeat(40), identity: local, taskId: clientTaskId });
    assert.equal(execution.status, "completed");
    assert.equal(execution.signedResultAccepted, true);
    assert.equal(execution.filesystemExecuted, true);
    assert.equal(execution.sha256, createHash("sha256").update(clientWork.content).digest("hex"));
    assert.equal((await pcBootstrap.executeLocalPcWork({ base, revision: "a".repeat(40), identity: local })).status, "idle");
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
  } finally {
    ingress.closeAllConnections();
    await new Promise<void>(resolve => ingress.close(() => resolve()));
    if (child.exitCode === null) await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
