import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DurableTaskRuntime, MemoryDurableTaskStore } from "../src/gai/durable-task-runtime.ts";
import { MemorySyncStore } from "../src/gai/sync-engine.ts";
import { canonicalWorkerRequest } from "../src/jarvis/worker-auth.ts";
import { PcTaskObservations, projectPcObservation, validatePcObservation, observationDigest, assertPcObserver, PC_OBSERVATION_RECEIVE } from "../src/jarvis/pc-task-observation.ts";
import { pcDigest } from "../src/jarvis/pc-durable-work.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";

const revision = "a".repeat(40);
const keys = generateKeyPairSync("ed25519");
const identity = { nodeId: "macbook", algorithm: "ed25519" as const, enrolledAt: new Date().toISOString(), publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
async function fixture(key = "unit") {
  const payload = { idempotencyKey: key, goalIssue: 1219, privacyClass: "PUBLIC", content: "public input",
    capsule: { goal: "#1219", currentJob: "#1754", why: "observe", workflowPosition: "sync", inputs: [], constraints: [], decisions: [], dependencies: [], expectedOutput: ["digest"], definitionOfDone: ["preserved"], verificationContract: "digest", recoveryContext: [] } };
  const id = "pc-" + createHash("sha256").update(`1219:${key}`).digest("hex");
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  const task = await runtime.enqueue({ id, idempotencyKey: id, type: "pc-public-file-sha256", payload, requiredCapabilities: ["filesystem"], migrationClass: "RESTARTABLE", maxAttempts: 3 });
  return { runtime, task, observation: projectPcObservation(task) };
}
function attestation(observation: ReturnType<typeof projectPcObservation>, sourceNodeId = "macbook") {
  const value = { taskId: observation.id, revision, sourceNodeId, observation }, rawBody = JSON.stringify(value);
  const unsigned = { nodeId: "macbook", timestamp: new Date().toISOString(), nonce: randomUUID(), method: "POST", path: PC_OBSERVATION_RECEIVE, bodySha256: createHash("sha256").update(rawBody).digest("hex") };
  return { value, proof: { rawBody, identity, signed: { ...unsigned, signatureBase64: sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), keys.privateKey).toString("base64") } } };
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "pc-observation-"));
  return { dir, service: new PcTaskObservations(join(dir, "observations.json"), revision) };
}
test("projection rejects non-public contracts and strips full history, errors and arbitrary fields", async () => {
  const { task, observation } = await fixture();
  assert.equal(observation.sequence, task.history.length);
  assert.equal("history" in observation, false); assert.equal("error" in observation, false);
  for (const bad of [{ ...observation, history: [] }, { ...observation, executionEpoch: -1 }, { ...observation, sequence: 0 },
    { ...observation, payload: { ...observation.payload, privacyClass: "SECRET" } }, { ...observation, id: "wrong" }]) assert.throws(() => validatePcObservation(bad));
  assert.throws(() => projectPcObservation({ ...task, status: "completed", result: { verified: true } }));
});
test("normal and reverse progress are compatible; equal sequence fork, ownership and input conflict stay sticky", async () => {
  const { dir, service } = await setup();
  try {
    const { task, runtime, observation } = await fixture();
    const claim = await runtime.leaseClaim(task.id, "macbook", 120000);
    const running = projectPcObservation(await runtime.markRunningClaimed(claim));
    for (const candidate of [running, observation]) { const p = attestation(candidate); assert.equal((await service.receive(p.value, p.proof)).conflicted, false); }
    const fork = structuredClone(running); fork.claim!.fencingToken += "fork";
    const p = attestation(fork); assert.equal((await service.receive(p.value, p.proof)).conflicted, true);
    const duplicate = attestation(observation), restarted = new PcTaskObservations(join(dir, "observations.json"), revision);
    const result = await restarted.receive(duplicate.value, duplicate.proof);
    assert.equal(result.duplicate, true); assert.equal(result.conflicted, true);
    const bundle = await restarted.get(task.id); assert.equal(bundle!.variants.length, 3);
    assert.equal(bundle!.variants[0].provenance.rawBody, attestation(running).proof.rawBody);
    const changed = structuredClone(observation); changed.payload.content = "other public input"; changed.sequence++;
    const c = attestation(changed); assert.equal((await restarted.receive(c.value, c.proof)).conflicted, true);
    assert.equal((await runtime.get(task.id))!.fencingToken, claim.fencingToken);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("signed source binding, exact revision, body integrity and request bounds reject before save", async () => {
  const { dir, service } = await setup();
  try {
    const { observation } = await fixture(), p = attestation(observation);
    for (const [value, proof] of [
      [{ ...p.value, sourceNodeId: "zbook" }, p.proof], [{ ...p.value, revision: "b".repeat(40) }, p.proof],
      [p.value, { ...p.proof, rawBody: p.proof.rawBody + " " }],
      [p.value, { ...p.proof, identity: { ...identity, revokedAt: new Date().toISOString() } }],
      [p.value, { ...p.proof, rawBody: " ".repeat(65537) }],
    ] as const) await assert.rejects(() => service.receive(value, proof));
    assert.equal(await service.get(observation.id), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("failed save never becomes successful duplicate; concurrent adapter writers retain both variants", async () => {
  const { dir } = await setup(), store = new MemorySyncStore(); let fail = true;
  const service = new PcTaskObservations(join(dir, "observations.json"), revision, () => ({ load: () => store.load(), save: async value => { if (fail) throw Error("disk failure"); await store.save(value); } }));
  try {
    const { observation } = await fixture(), p = attestation(observation);
    await assert.rejects(() => service.receive(p.value, p.proof), /disk failure/); fail = false;
    assert.equal((await service.receive(p.value, p.proof)).duplicate, false);
    const other = structuredClone(observation); other.sequence++; other.status = "retrying";
    const q = attestation(other), second = new PcTaskObservations(join(dir, "observations.json"), revision, () => store);
    await Promise.all([service.receive(p.value, p.proof), second.receive(q.value, q.proof)]);
    assert.equal((await second.get(observation.id))!.variants.length, 2);
    assert.equal(observationDigest(validatePcObservation(JSON.parse(JSON.stringify(observation)))), observationDigest(observation));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("variant and task capacity reject without evicting evidence", async () => {
  const { dir, service } = await setup();
  try {
    const { observation } = await fixture();
    for (let i = 1; i <= 16; i++) { const p = attestation({ ...observation, sequence: i }); await service.receive(p.value, p.proof); }
    const overflow = attestation({ ...observation, sequence: 17 });
    await assert.rejects(() => service.receive(overflow.value, overflow.proof), /CAPACITY/);
    assert.equal((await service.get(observation.id))!.variants.length, 16);
    for (let i = 1; i < 64; i++) { const p = attestation((await fixture("task-" + i)).observation); await service.receive(p.value, p.proof); }
    const p = attestation((await fixture("task-overflow")).observation);
    await assert.rejects(() => service.receive(p.value, p.proof), /CAPACITY/); assert.equal(await service.get(p.value.taskId), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("terminal and epoch regressions conflict independently of delivery order; peer sequence is independent", async () => {
  for (const reverse of [false, true]) {
    const { dir, service } = await setup();
    try {
      const { task, runtime } = await fixture("terminal"), claim = await runtime.leaseClaim(task.id, "macbook");
      const running = projectPcObservation(await runtime.markRunningClaimed(claim));
      const now = new Date();
      const completed = projectPcObservation(await runtime.completeClaimed(claim, { ...pcDigest("public input"), nodeId: "macbook", goalIssue: 1219,
        verified: true, issuer: "signed-worker-request", executionEpoch: claim.epoch, observedAt: now.toISOString() }, now));
      const regression = { ...running, sequence: completed.sequence + 1 };
      const values = reverse ? [regression, completed] : [completed, regression];
      for (const v of values) { const p = attestation(v); await service.receive(p.value, p.proof); }
      assert.equal((await service.get(task.id))!.conflicted, true);
      const other = await fixture("epoch"), active = { ...running, id: other.task.id, idempotencyKey: other.task.id, payload: other.observation.payload,
        claim: { ...running.claim!, taskId: other.task.id }, sequence: 4 };
      const higher = { ...active, executionEpoch: 2, sequence: 3, claim: { ...active.claim, epoch: 2 } };
      for (const v of reverse ? [active, higher] : [higher, active]) { const p = attestation(v); await service.receive(p.value, p.proof); }
      assert.equal((await service.get(other.task.id))!.conflicted, true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
test("different source epochs cannot silently establish ownership or erase an ambiguity", async () => {
  const { dir, service } = await setup();
  try {
    const { task, runtime } = await fixture("independent"), claim = await runtime.leaseClaim(task.id, "macbook");
    const active = projectPcObservation(await runtime.markRunningClaimed(claim));
    const p = attestation(active); await service.receive(p.value, p.proof);
    const conflicting = { ...active, executionEpoch: 2, sequence: 1, claim: { ...active.claim!, owner: "zbook", epoch: 2, fencingToken: "another" } };
    const peerKeys = generateKeyPairSync("ed25519");
    const peerIdentity = { ...identity, nodeId: "zbook", publicKeyPem: peerKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
    const value = { ...p.value, sourceNodeId: "zbook", observation: conflicting }, rawBody = JSON.stringify(value);
    const unsigned = { ...p.proof.signed, nodeId: "zbook", nonce: randomUUID(), bodySha256: createHash("sha256").update(rawBody).digest("hex") };
    const proof = { rawBody, identity: peerIdentity, signed: { ...unsigned, signatureBase64: sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), peerKeys.privateKey).toString("base64") } };
    assert.equal((await service.receive(value, proof)).conflicted, true);
    assert.equal((await service.receive(p.value, p.proof)).conflicted, true);
    assert.equal((await service.get(task.id))!.variants.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("observation role requires current enrolled #1662/#1219 Storage and Coordinator", () => {
  const node = { id: "macbook", kind: "macos", pcAuthority: { version: 1, approvalIssue: 1662, goalIssue: 1219, roles: ["Storage", "Coordinator"] } } as JarvisNode;
  assert.doesNotThrow(() => assertPcObserver(node, identity));
  for (const changed of [{ ...node, id: "other" }, { ...node, kind: "linux" },
    { ...node, pcAuthority: { ...node.pcAuthority!, roles: ["Coordinator"] } },
    { ...node, pcAuthority: { ...node.pcAuthority!, goalIssue: 1754 } }]) assert.throws(() => assertPcObserver(changed as JarvisNode, identity));
  assert.throws(() => assertPcObserver(node, { ...identity, revokedAt: new Date().toISOString() }));
});
test("separate processes serialize observation bundle saves without lost updates", async t => {
  const { dir, service } = await setup(), { observation } = await fixture("process-writers");
  const children: ReturnType<typeof spawn>[] = [];
  t.after(async () => {
    await Promise.all(children.map(async child => { if (child.exitCode === null && child.signalCode === null) { const done = once(child, "exit"); child.kill(); await done; } }));
    await rm(dir, { recursive: true, force: true });
  });
  const moduleUrl = new URL("../src/jarvis/pc-task-observation.ts", import.meta.url).href;
  const run = async (sequence: number) => {
    const p = attestation({ ...observation, sequence });
    const code = `import { PcTaskObservations } from ${JSON.stringify(moduleUrl)}; const p=JSON.parse(process.argv[1]); await new PcTaskObservations(process.argv[2],process.argv[3]).receive(p.value,p.proof);`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, JSON.stringify(p), join(dir, "observations.json"), revision], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    children.push(child); let err = ""; child.stderr!.on("data", chunk => { err += chunk; });
    const [exit] = await once(child, "exit"); assert.equal(exit, 0, err);
  };
  await Promise.all([run(1), run(2), run(3)]);
  assert.equal((await service.get(observation.id))!.variants.length, 3);
});
