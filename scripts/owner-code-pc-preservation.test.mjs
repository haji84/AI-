import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, renameSync, rmSync, symlinkSync, linkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

let api = {};
try { api = await import("./owner-code-pc-preservation.mjs"); } catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
const AT = "2026-11-04T10:00:00.000Z", LATER = "2026-11-04T10:01:00.000Z";
const keys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" });
const sha = (value) => createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value);
}
function task(key = "PUBLIC-PRIVATE-SENTINEL") {
  const id = "pc-" + sha(`1219:${key}`);
  const payload = { idempotencyKey: key, goalIssue: 1219, privacyClass: "PUBLIC", content: "PRIVATE-SENTINEL content with spaces", capsule: {
    goal: "#1219", currentJob: "PRIVATE-SENTINEL", why: "public fixture", workflowPosition: "fixture", inputs: [], constraints: [], decisions: [], dependencies: [], expectedOutput: ["digest"], definitionOfDone: ["digest"], verificationContract: "public fixture", recoveryContext: [],
  } };
  return { id, idempotencyKey: id, type: "pc-public-file-sha256", payload, status: "queued", priority: "normal", requiredCapabilities: ["filesystem"], dependsOn: [], attempts: 0, maxAttempts: 3, migrationClass: "RESTARTABLE", executionEpoch: 0, createdAt: AT, updatedAt: AT, history: [{ from: null, to: "queued", at: AT, reason: "task enqueued" }] };
}
function observationVariant(t, sequence = 1) {
  const observation = { version: 1, id: t.id, idempotencyKey: t.id, type: t.type, payload: globalThis.structuredClone(t.payload), migrationClass: "RESTARTABLE", requiredCapabilities: ["filesystem"], status: "queued", executionEpoch: 0, sequence };
  const body = { taskId: t.id, revision: "a".repeat(40), sourceNodeId: "macbook", observation };
  const rawBody = JSON.stringify(body);
  const signed = { nodeId: "macbook", timestamp: AT, nonce: "PRIVATE-SENTINEL-nonce", method: "POST", path: "/api/jarvis/worker/pc/observation/receive", bodySha256: sha(rawBody) };
  signed.signatureBase64 = sign(null, Buffer.from([signed.nodeId, signed.timestamp, signed.nonce, signed.method, signed.path, signed.bodySha256].join("\n")), keys.privateKey).toString("base64");
  return { digest: sha(canonical(observation)), sourceNodeId: "macbook", observation, provenance: { rawBody, signed, identity: { nodeId: "macbook", publicKeyPem, enrolledAt: AT, algorithm: "ed25519" } } };
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "public-pc-preservation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "PRIVATE-SENTINEL-broker.db");
  const tasks = { version: 1, tasks: [task()], savedAt: AT };
  const item = tasks.tasks[0];
  const observations = { version: 1, records: [{ recordId: item.id, entityType: "evidence", version: 1, deviceId: "pc-observation-adapter", updatedAt: AT, clock: { "pc-observation-adapter": 1 }, syncState: "pending-push", ownerTaskId: item.id, verification: { status: "unverified" }, value: { version: 1, taskId: item.id, conflicted: false, variants: [observationVariant(item)] } }], savedAt: AT };
  const options = { profile: "jarvis-pc-sidecars-v1", expectedTaskFile: "present", expectedObservationFile: "present" };
  const f = { root, path, tasks, observations, options, write() {
    for (const [suffix, value] of [[".pc-tasks.json", tasks], [".pc-observations.json", observations]]) {
      const temporary = path + suffix + ".public.tmp";
      writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
      renameSync(temporary, path + suffix);
    }
  } };
  f.write(); return f;
}
function capture(f, options = f.options) {
  assert.equal(typeof api.capturePcSidecarSnapshot, "function", "PC sidecar preservation capture is missing");
  return api.capturePcSidecarSnapshot(f.path, options);
}
function compare(f, change) { const before = capture(f); change(); f.write(); return api.comparePcSidecarSnapshots(before, capture(f)); }
function safe(value) { assert.doesNotMatch(JSON.stringify(value), /PRIVATE-SENTINEL|BEGIN PUBLIC KEY|pc-[a-f0-9]{64}|broker\.db|[a-f0-9]{40}/); }
function fixedError(fn, code) { assert.throws(fn, (e) => e.message === code && e.code === code && e.cause === undefined && !/PRIVATE-SENTINEL|BEGIN PUBLIC KEY|broker\.db/.test(e.stack)); }
function run(f) {
  const t = f.tasks.tasks[0];
  Object.assign(t, { status: "running", attempts: 1, executionEpoch: 1, leaseOwner: "macbook", leaseUntil: "2026-11-04T10:03:00.000Z", fencingToken: "public-fence", updatedAt: LATER });
  t.history.push({ from: "queued", to: "leased", at: LATER, reason: "lease acquired", actor: "macbook", evidence: { leaseUntil: t.leaseUntil } }, { from: "leased", to: "running", at: LATER, reason: "execution started", actor: "macbook", evidence: { executionEpoch: 1 } });
}

test("real pretty JSON sidecars are captured privately and survive actual atomic rename", (t) => {
  const f = fixture(t), bytes = readFileSync(f.path + ".pc-tasks.json");
  const before = capture(f), summary = api.pcSidecarSummary(before);
  assert.equal(Object.isFrozen(before), true); assert.deepEqual(Reflect.ownKeys(before), []); assert.equal(JSON.stringify(before), "{}");
  assert.equal(summary.taskCount, 1); assert.equal(summary.observationCount, 1); assert.equal(summary.variantCount, 1);
  assert.deepEqual(readFileSync(f.path + ".pc-tasks.json"), bytes);
  f.write(); const result = api.comparePcSidecarSnapshots(before, capture(f));
  assert.equal(result.status, "PASS"); assert.equal(result.coverage.wholeR06, false); assert.equal(result.coverage.crossStoreAtomicity, false);
  safe({ before, summary, result });
});
test("validated task execution progresses with an exact original history prefix", (t) => {
  const f = fixture(t), result = compare(f, () => run(f));
  assert.equal(result.status, "PASS"); assert.equal(result.operationalChanges.tasksAdvanced, 1); safe(result);
});
test("same-claim heartbeat advances lease without inventing a history transition", (t) => {
  const f = fixture(t); run(f); f.write();
  assert.equal(compare(f, () => { f.tasks.tasks[0].leaseUntil = "2026-11-04T10:04:00.000Z"; f.tasks.tasks[0].updatedAt = "2026-11-04T10:02:00.000Z"; }).status, "PASS");
});
test("running history cannot contradict the active lease actor", (t) => {
  const f = fixture(t), before = capture(f); run(f);
  f.tasks.tasks[0].history.at(-1).actor = "zbook";
  f.write();
  fixedError(() => api.comparePcSidecarSnapshots(before, capture(f)), "PC_PAYLOAD_INVALID");
});
test("running history cannot contradict the active lease epoch", (t) => {
  const f = fixture(t), before = capture(f); run(f);
  f.tasks.tasks[0].history.at(-1).evidence.executionEpoch = 2;
  f.write();
  fixedError(() => api.comparePcSidecarSnapshots(before, capture(f)), "PC_PAYLOAD_INVALID");
});
test("legacy running history without evidence retains the same lease actor", (t) => {
  const f = fixture(t);
  const result = compare(f, () => { run(f); delete f.tasks.tasks[0].history.at(-1).evidence; });
  assert.equal(result.status, "PASS");
});
test("new tasks and signed observation variants preserve the original records", (t) => {
  const f = fixture(t), result = compare(f, () => {
    f.tasks.tasks.push(task("public-next"));
    const r = f.observations.records[0]; r.value.variants.push(observationVariant(f.tasks.tasks[0], 2)); r.version++; r.clock["pc-observation-adapter"]++; r.updatedAt = LATER;
  });
  assert.equal(result.status, "PASS"); assert.equal(result.operationalChanges.tasksAdded, 1); assert.equal(result.operationalChanges.variantsAdded, 1);
});
test("claimed task completes only with retained history and source-derived result", (t) => {
  const f = fixture(t); run(f); f.write();
  const result = compare(f, () => {
    const x = f.tasks.tasks[0]; delete x.leaseOwner; delete x.leaseUntil; delete x.fencingToken;
    Object.assign(x, { status: "completed", result: { sha256: sha(x.payload.content), bytes: Buffer.byteLength(x.payload.content), nodeId: "macbook", goalIssue: 1219, verified: true, issuer: "signed-worker-request", executionEpoch: 1, observedAt: LATER } });
    x.history.push({ from: "running", to: "completed", at: LATER, reason: "execution verified complete", actor: "macbook", evidence: { executionEpoch: 1 } });
  }); assert.equal(result.status, "PASS");
});
for (const [name, change] of [
  ["task deletion", f => { f.tasks.tasks = []; }],
  ["same-count task substitution", f => { f.tasks.tasks = [task("replacement")]; }],
  ["task payload edit", f => { f.tasks.tasks[0].payload.content += "tampered"; }],
  ["task context edit", f => { f.tasks.tasks[0].payload.capsule.currentJob = "changed"; }],
  ["history rewrite", f => { f.tasks.tasks[0].history[0].reason = "rewritten"; }],
  ["observation deletion", f => { f.observations.records = []; }],
  ["provenance replacement", f => { f.observations.records[0].value.variants[0].provenance.identity.enrolledAt = "2026-11-03T10:00:00.000Z"; }],
  ["variant deletion", f => { f.observations.records[0].value.variants = []; }],
]) test(`${name} cannot pass preservation`, (t) => {
  const f = fixture(t), before = capture(f); change(f); f.write();
  try { const result = api.comparePcSidecarSnapshots(before, capture(f)); assert.notEqual(result.status, "PASS"); safe(result); }
  catch (error) { assert.match(error.code, /^PC_(PAYLOAD_INVALID|FILE_UNAVAILABLE)$/); safe({ code: error.code, message: error.message }); }
});
test("clearing a sticky observation conflict fails", (t) => {
  const f = fixture(t); f.observations.records[0].value.conflicted = true; f.write();
  assert.equal(compare(f, () => { f.observations.records[0].value.conflicted = false; }).status, "FAIL");
});
test("an appended conflicting observation cannot hide its conflict flag", (t) => {
  const f = fixture(t); capture(f);
  const changed = globalThis.structuredClone(f.tasks.tasks[0]); changed.payload.content = "different public content";
  const r = f.observations.records[0]; r.value.variants.push(observationVariant(changed)); r.version++; r.clock["pc-observation-adapter"]++;
  f.write(); fixedError(() => capture(f), "PC_PAYLOAD_INVALID");
});
test("signed conflicting variants may append with a sticky visible conflict", (t) => {
  const f = fixture(t);
  const result = compare(f, () => {
    const changed = globalThis.structuredClone(f.tasks.tasks[0]); changed.payload.content = "different public content";
    const r = f.observations.records[0]; r.value.variants.push(observationVariant(changed)); r.version++; r.clock["pc-observation-adapter"]++; r.value.conflicted = true;
  }); assert.equal(result.status, "PASS");
});
test("observation metadata cannot change without an appended variant", (t) => {
  const f = fixture(t);
  assert.equal(compare(f, () => { f.observations.records[0].updatedAt = LATER; }).status, "FAIL");
});
test("completion cannot switch executor without a new lease", (t) => {
  const f = fixture(t); run(f); capture(f);
  const x = f.tasks.tasks[0]; delete x.leaseOwner; delete x.leaseUntil; delete x.fencingToken;
  Object.assign(x, { status: "completed", result: { sha256: sha(x.payload.content), bytes: Buffer.byteLength(x.payload.content), nodeId: "zbook", goalIssue: 1219, verified: true, issuer: "signed-worker-request", executionEpoch: 1, observedAt: LATER } });
  x.history.push({ from: "running", to: "completed", at: LATER, reason: "execution verified complete", actor: "zbook", evidence: { executionEpoch: 1 } });
  f.write(); fixedError(() => capture(f), "PC_PAYLOAD_INVALID");
});
test("attempt and epoch reset fail even when rows and payloads remain", (t) => {
  const f = fixture(t); run(f); f.write(); const before = capture(f);
  f.tasks.tasks[0].attempts = 0; f.write(); fixedError(() => capture(f), "PC_PAYLOAD_INVALID");
  f.tasks.tasks[0].attempts = 1; f.tasks.tasks[0].executionEpoch = 0; f.write(); fixedError(() => capture(f), "PC_PAYLOAD_INVALID");
  assert.equal(api.pcSidecarSummary(before).taskCount, 1);
});
for (const [name, change] of [
  ["unknown envelope", f => { f.tasks.secret = "PRIVATE-SENTINEL"; }],
  ["unknown task field", f => { f.tasks.tasks[0].secret = "PRIVATE-SENTINEL"; }],
  ["unknown task status", f => { f.tasks.tasks[0].status = "surprise"; }],
  ["unknown history field", f => { f.tasks.tasks[0].history[0].secret = "PRIVATE-SENTINEL"; }],
  ["unknown provenance field", f => { f.observations.records[0].value.variants[0].provenance.secret = "PRIVATE-SENTINEL"; }],
  ["unknown capsule field", f => { f.tasks.tasks[0].payload.capsule.secret = "PRIVATE-SENTINEL"; }],
  ["duplicate task ID", f => { f.tasks.tasks.push(globalThis.structuredClone(f.tasks.tasks[0])); }],
  ["unknown observation version", f => { f.observations.version = 2; }],
  ["wrong observation digest", f => { f.observations.records[0].value.variants[0].digest = "0".repeat(64); }],
  ["wrong signed body", f => { f.observations.records[0].value.variants[0].provenance.rawBody += " "; }],
]) test(`${name} fails with a fixed private error`, (t) => {
  const f = fixture(t); change(f); f.write(); fixedError(() => capture(f), "PC_PAYLOAD_INVALID");
});
test("duplicate JSON property and nonwriter JSON do not pass through JSON.parse", (t) => {
  const f = fixture(t); capture(f);
  writeFileSync(f.path + ".pc-tasks.json", '{"version":1,"version":1,"tasks":[],"savedAt":"' + AT + '"}');
  fixedError(() => capture(f), "PC_PAYLOAD_INVALID");
});
test("required missing, symlink and hardlink sidecars fail without path leakage", (t) => {
  const f = fixture(t); capture(f); const path = f.path + ".pc-tasks.json", hold = join(f.root, "public-hold.json");
  renameSync(path, hold); fixedError(() => capture(f), "PC_FILE_UNAVAILABLE");
  symlinkSync(hold, path); fixedError(() => capture(f), "PC_FILE_UNAVAILABLE"); unlinkSync(path);
  linkSync(hold, path); fixedError(() => capture(f), "PC_FILE_UNAVAILABLE");
});
test("oversized and truncated sidecars fail before data can escape", (t) => {
  const f = fixture(t); capture(f);
  writeFileSync(f.path + ".pc-tasks.json", "x".repeat(8 * 1024 * 1024 + 1)); fixedError(() => capture(f), "PC_FILE_UNAVAILABLE");
  writeFileSync(f.path + ".pc-tasks.json", '{"PRIVATE-SENTINEL":'); fixedError(() => capture(f), "PC_PAYLOAD_INVALID");
});
test("explicit baseline absence permits later valid append without claiming atomicity", (t) => {
  const f = fixture(t); unlinkSync(f.path + ".pc-tasks.json"); unlinkSync(f.path + ".pc-observations.json");
  const options = { ...f.options, expectedTaskFile: "absent", expectedObservationFile: "absent" };
  const before = capture(f, options); assert.equal(api.pcSidecarSummary(before).taskFilePresent, false);
  f.write(); const result = api.comparePcSidecarSnapshots(before, capture(f, options));
  assert.equal(result.status, "PASS"); assert.equal(result.operationalChanges.tasksAdded, 1); assert.equal(result.coverage.wholeR06, false);
});
test("missing explicit presence options, path drift and forged handles fail closed", (t) => {
  const f = fixture(t); const before = capture(f);
  for (const options of [undefined, {}, { ...f.options, profile: "unknown" }, { profile: f.options.profile, expectedTaskFile: "present" }, { ...f.options, unknown: true }]) fixedError(() => api.capturePcSidecarSnapshot(f.path, options), "PC_OPTIONS_INVALID");
  fixedError(() => api.pcSidecarSummary({}), "PC_HANDLE_INVALID"); fixedError(() => api.comparePcSidecarSnapshots(before, {}), "PC_HANDLE_INVALID");
  const g = fixture(t); assert.equal(api.comparePcSidecarSnapshots(before, capture(g)).bindingMatched, false);
  assert.equal(api.comparePcSidecarSnapshots(before, capture(f, { ...f.options, expectedTaskFile: "absent" })).status, "FAIL");
});
