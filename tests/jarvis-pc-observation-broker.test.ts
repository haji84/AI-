import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { registerLocalPc } from "../src/jarvis/pc-bootstrap.ts";
import { canonicalWorkerRequest } from "../src/jarvis/worker-auth.ts";
import { privatePcRelay } from "../src/jarvis/private-pc-transport.ts";
import { synchronizePcObservation } from "../src/jarvis/pc-observation-client.ts";
import { PC_OBSERVATION_EXPORT, PC_OBSERVATION_RECEIVE, PcTaskObservations } from "../src/jarvis/pc-task-observation.ts";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import type { PcLocalIdentity } from "../src/jarvis/pc-local-identity.ts";

const revision = "a".repeat(40);
function identity(nodeId: "macbook" | "zbook"): PcLocalIdentity {
  const keys = generateKeyPairSync("ed25519");
  return { version: 1, nodeId, platform: nodeId === "zbook" ? "windows" : "macos", algorithm: "ed25519",
    hostBinding: "fixture", createdAt: new Date().toISOString(), publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
function signed(base: string, path: string, payload: unknown, node: PcLocalIdentity): Request {
  const body = JSON.stringify(payload), unsigned = { nodeId: node.nodeId, method: "POST", path, nonce: randomUUID(),
    timestamp: new Date().toISOString(), bodySha256: createHash("sha256").update(body).digest("hex") };
  return new Request(base + path, { method: "POST", body, signal: AbortSignal.timeout(5000), headers: {
    "Content-Type": "application/json", "X-Jarvis-Node-Id": node.nodeId, "X-Jarvis-Timestamp": unsigned.timestamp,
    "X-Jarvis-Nonce": unsigned.nonce, "X-Jarvis-Body-Sha256": unsigned.bodySha256,
    "X-Jarvis-Signature": sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), node.privateKeyPem).toString("base64") } });
}
test("two isolated Brokers retain actual file completion across signed ACK loss, retry, conflict and restart without importing execution", { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "pc-observation-brokers-")), mac = identity("macbook"), zbook = identity("zbook");
  const children = new Set<ChildProcess>();
  t.after(async () => {
    await Promise.all([...children].map(async child => {
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    }));
    await rm(dir, { recursive: true, force: true });
  });
  const create = async (name: string) => {
    const home = join(dir, name); await mkdir(home, { recursive: true });
    const db = join(home, "broker.sqlite"), owner = randomUUID();
    const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
    const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()));
    const base = "http://127.0.0.1:" + port;
    await writeFile(db + ".pc-enrollment-approval.json", JSON.stringify({ version: 1, issue: 1662, goalIssue: 1219,
      approvedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      targets: [{ nodeId: "macbook", platform: "macos" }, { nodeId: "zbook", platform: "windows" }], roles: ["Executor", "Storage", "Verifier", "Coordinator"] }), { mode: 0o600 });
    const env = { ...process.env, USERPROFILE: home, HOME: home, TMPDIR: home, TMP: home, TEMP: home, GITHUB_TOKEN: "",
      GORIQ_RUNTIME_REVISION: revision, JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port),
      JARVIS_OWNER_TOKEN: owner, JARVIS_DB_PATH: db, JARVIS_COMPASS_DB_PATH: join(home, "compass.sqlite"),
      JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" };
    let broker: ChildProcess;
    const start = async () => {
      broker = spawn(process.execPath, ["scripts/jarvis-broker.ts"], { stdio: "ignore", windowsHide: true, env }); children.add(broker);
      for (let i = 0; i < 120; i++) {
        try { if ((await fetch(base + "/health", { signal: AbortSignal.timeout(200) })).ok) return; } catch { /* bounded isolated startup */ }
        if (broker.exitCode !== null) assert.fail("fixture Broker exited");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail("fixture Broker startup timed out");
    };
    const restart = async () => { const exited = once(broker, "exit"); broker.kill(); await exited; await start(); };
    await start(); for (const node of [mac, zbook]) await registerLocalPc({ base, revision, ownerToken: owner, identity: node });
    return { base, db, home, owner, env, restart };
  };
  const a = await create("source"), b = await create("receiver");
  const enqueue = async (broker: typeof a, key: string, nodeId: string) => {
    const response = await fetch(broker.base + "/api/jarvis/admin/pc-tasks", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + broker.owner },
      body: JSON.stringify({ idempotencyKey: key, goalIssue: 1219, targetNodeId: nodeId, privacyClass: "PUBLIC", content: "PUBLIC actual observation workload " + key,
        capsule: { goal: "#1219", currentJob: "#1754", why: "verify actual completion observation", workflowPosition: "file -> export -> peer sync", inputs: [], constraints: ["public"], decisions: [], dependencies: [], expectedOutput: ["digest"], definitionOfDone: ["retained observation"], verificationContract: "independent digest", recoveryContext: ["no ownership import"] } }) });
    assert.equal(response.status, 201); return (await response.json()).task.id as string;
  };
  const taskId = await enqueue(a, "source", "macbook"); await enqueue(b, "unrelated", "zbook");
  const queued = await (await fetch(signed(a.base, PC_OBSERVATION_EXPORT, { taskId, revision }, mac))).json();
  await mkdir(join(a.home, "JARVIS", "production", "pc-node", "macbook"), { recursive: true });
  await mkdir(join(a.home, ".goriq", "state", "pc-node", "macbook"), { recursive: true, mode: 0o700 });
  const client = join(a.home, "execute.mjs"), input = join(a.home, "input.json");
  await writeFile(client, `import { readFile } from 'node:fs/promises';\nimport { executeLocalPcWork } from ${JSON.stringify(new URL("../src/jarvis/pc-bootstrap.ts", import.meta.url).href)};\nconsole.log(JSON.stringify(await executeLocalPcWork(JSON.parse(await readFile(process.argv[2],'utf8')))));`);
  await writeFile(input, JSON.stringify({ base: a.base, revision, taskId, identity: mac }), { mode: 0o600 });
  const worker = spawn(process.execPath, [client, input], { env: a.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); children.add(worker);
  let workerOut = "", workerError = ""; worker.stdout.on("data", chunk => { workerOut += chunk; }); worker.stderr.on("data", chunk => { workerError += chunk; });
  const [workerCode] = await once(worker, "exit"); assert.equal(workerCode, 0, workerError);
  const execution = JSON.parse(workerOut); assert.equal(execution.filesystemExecuted, true); assert.equal(execution.status, "completed");
  const oracleInput = "PUBLIC actual observation workload source";
  assert.equal(execution.sha256, createHash("sha256").update(oracleInput).digest("hex"));
  assert.equal(execution.bytes, Buffer.byteLength(oracleInput));
  const queueA = await readFile(a.db + ".pc-tasks.json", "utf8"), queueB = await readFile(b.db + ".pc-tasks.json", "utf8");
  let cut = true, spoofRevision = false, tamperAck = false;
  const relay = privatePcRelay({ ingress: async () => true, signer: async () => ({ identity: zbook, revision: spoofRevision ? "b".repeat(40) : revision, roles: ["Storage", "Coordinator"] }),
    upstream: (url, options) => fetch(b.base + new URL(String(url)).pathname, options) });
  const proxy = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part));
      const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (value && key !== "host") headers.set(key, String(value));
      const result = await relay(new Request("https://zbook.tailfixture.ts.net" + req.url, { method: "POST", headers, body: Buffer.concat(chunks) }));
      const bytes = await result.arrayBuffer();
      if (cut) { cut = false; res.destroy(); return; }
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(tamperAck ? "{}" : Buffer.from(bytes));
    } catch { res.destroy(); }
  });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  t.after(async () => { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); });
  const transport = "http://127.0.0.1:" + (proxy.address() as { port: number }).port;
  const sync = (id = taskId) => synchronizePcObservation({ localBase: a.base, peerBase: "https://zbook.tailfixture.ts.net", tailnetDomain: "tailfixture.ts.net", revision, taskId: id, identity: mac,
    peer: { nodeId: zbook.nodeId, algorithm: "ed25519", publicKeyPem: zbook.publicKeyPem, enrolledAt: zbook.createdAt },
    peerRequest: async request => { const original = request as Request; return fetch(new Request(transport + new URL(original.url).pathname, original)); } });
  await assert.rejects(sync); assert.equal(cut, false);
  const observations = new PcTaskObservations(b.db + ".pc-observations.json", revision);
  assert.equal((await observations.get(taskId))!.variants.length, 1);
  await b.restart(); const recovered = await sync(); assert.equal(recovered.duplicate, true); assert.equal(recovered.conflicted, false);
  const source = (await observations.get(taskId))!.variants[0].observation;
  assert.equal(source.status, "completed"); assert.equal(source.result!.sha256, execution.sha256);
  const envelope = (observation: unknown) => ({ taskId, revision, sourceNodeId: "macbook", observation });
  const reverse = await fetch(signed(b.base, PC_OBSERVATION_RECEIVE, envelope(queued), mac)); assert.equal(reverse.status, 200); assert.equal((await reverse.json()).conflicted, false);
  const fork = structuredClone(source); fork.result!.observedAt = new Date(Date.parse(fork.result!.observedAt) + 1).toISOString();
  const forked = await fetch(signed(b.base, PC_OBSERVATION_RECEIVE, envelope(fork), mac)); assert.equal((await forked.json()).conflicted, true);
  await b.restart(); assert.equal((await sync()).conflicted, true);
  const beforeRejects = await readFile(b.db + ".pc-observations.json", "utf8");
  for (const [payload, signer] of [[{ ...envelope(source), revision: "c".repeat(40) }, mac], [{ ...envelope(source), sourceNodeId: "zbook" }, mac], [envelope(source), identity("macbook")]] as const) {
    assert.ok([401, 409].includes((await fetch(signed(b.base, PC_OBSERVATION_RECEIVE, payload, signer))).status));
  }
  const altered = signed(b.base, PC_OBSERVATION_RECEIVE, envelope(source), mac);
  assert.equal((await fetch(new Request(altered.url, { method: "POST", headers: altered.headers, body: JSON.stringify(envelope(queued)) }))).status, 401);
  const replay = signed(b.base, PC_OBSERVATION_RECEIVE, envelope(source), mac);
  assert.equal((await fetch(replay.clone())).status, 200); assert.equal((await fetch(replay.clone())).status, 401);
  const db = new JarvisSqliteStateStore(b.db), registered = db.getWorkerIdentity("macbook")!;
  try { db.saveWorkerIdentity({ ...registered, revokedAt: new Date().toISOString() }); assert.equal((await fetch(signed(b.base, PC_OBSERVATION_RECEIVE, envelope(source), mac))).status, 401); }
  finally { db.saveWorkerIdentity(registered); db.close(); }
  spoofRevision = true; await assert.rejects(sync, /PEER_PROOF/); spoofRevision = false;
  tamperAck = true; await assert.rejects(sync, /PEER_PROOF/); tamperAck = false;
  const deniedExport = await relay(signed("https://zbook.tailfixture.ts.net", PC_OBSERVATION_EXPORT, { taskId, revision }, mac)); assert.equal(deniedExport.status, 404);
  assert.equal(await readFile(b.db + ".pc-observations.json", "utf8"), beforeRejects);
  assert.equal(await readFile(a.db + ".pc-tasks.json", "utf8"), queueA);
  assert.equal(await readFile(b.db + ".pc-tasks.json", "utf8"), queueB);
  // Local persistence is a prerequisite to sending; a failed local ACK cannot
  // cause a peer-only observation whose local conflict would stay invisible.
  let sends = 0;
  await assert.rejects(() => synchronizePcObservation({ localBase: a.base, peerBase: "https://zbook.tailfixture.ts.net", tailnetDomain: "tailfixture.ts.net", revision, taskId, identity: mac,
    peer: { nodeId: "zbook", algorithm: "ed25519", publicKeyPem: zbook.publicKeyPem, enrolledAt: zbook.createdAt },
    localRequest: async (request, options) => request instanceof Request && new URL(request.url).pathname === PC_OBSERVATION_RECEIVE
      ? Response.json({ unavailable: true }, { status: 503 }) : fetch(request, options),
    peerRequest: async () => { sends++; throw Error("unexpected send"); } }), /RECEIVE_REJECTED/);
  assert.equal(sends, 0);
  // Independently enqueued same task ID diverges on the second Broker. Only the
  // normal Owner enqueue and reciprocal client paths are used, never store seeding.
  assert.equal(await enqueue(b, "source", "zbook"), taskId);
  const peerQueue = await readFile(b.db + ".pc-tasks.json", "utf8");
  const relayA = privatePcRelay({ ingress: async () => true, signer: async () => ({ identity: mac, revision, roles: ["Coordinator", "Storage"] }),
    upstream: (url, options) => fetch(a.base + new URL(String(url)).pathname, options) });
  const returned = await synchronizePcObservation({ localBase: b.base, peerBase: "https://macbook.tailfixture.ts.net", tailnetDomain: "tailfixture.ts.net", revision, taskId, identity: zbook,
    peer: { nodeId: "macbook", algorithm: "ed25519", publicKeyPem: mac.publicKeyPem, enrolledAt: mac.createdAt }, peerRequest: request => relayA(request as Request) });
  assert.equal(returned.conflicted, true);
  assert.equal((await new PcTaskObservations(a.db + ".pc-observations.json", revision).get(taskId))!.conflicted, true);
  assert.equal((await observations.get(taskId))!.conflicted, true);
  await a.restart(); await b.restart(); assert.equal((await sync()).conflicted, true);
  assert.equal(await readFile(a.db + ".pc-tasks.json", "utf8"), queueA);
  assert.equal(await readFile(b.db + ".pc-tasks.json", "utf8"), peerQueue);
  const cleanId = await enqueue(a, "clean-divergence", "macbook");
  assert.equal(await enqueue(b, "clean-divergence", "zbook"), cleanId);
  const localObservations = new PcTaskObservations(a.db + ".pc-observations.json", revision);
  assert.equal(await localObservations.get(cleanId), undefined); assert.equal(await observations.get(cleanId), undefined);
  const cleanQueueA = await readFile(a.db + ".pc-tasks.json", "utf8"), cleanQueueB = await readFile(b.db + ".pc-tasks.json", "utf8");
  assert.equal((await sync(cleanId)).conflicted, false);
  const cleanReturn = await synchronizePcObservation({ localBase: b.base, peerBase: "https://macbook.tailfixture.ts.net", tailnetDomain: "tailfixture.ts.net", revision, taskId: cleanId, identity: zbook,
    peer: { nodeId: "macbook", algorithm: "ed25519", publicKeyPem: mac.publicKeyPem, enrolledAt: mac.createdAt }, peerRequest: request => relayA(request as Request) });
  assert.equal(cleanReturn.conflicted, true);
  for (const store of [localObservations, observations]) {
    const bundle = await store.get(cleanId); assert.equal(bundle!.conflicted, true);
    assert.deepEqual(bundle!.variants.map(v => v.sourceNodeId).sort(), ["macbook", "zbook"]);
  }
  assert.equal(await readFile(a.db + ".pc-tasks.json", "utf8"), cleanQueueA);
  assert.equal(await readFile(b.db + ".pc-tasks.json", "utf8"), cleanQueueB);
});
