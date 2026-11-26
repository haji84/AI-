import { createHash, createPublicKey, verify } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const PROFILE = "jarvis-pc-sidecars-v1", MAX_BYTES = 8 * 1024 * 1024;
const snapshots = new WeakMap(), ownErrors = new WeakSet();
const COVERAGE = Object.freeze({ pcTaskSidecars: true, pcObservationSidecars: true, workerPrivateKeys: false, compassHistory: false, cognitiveHistory: false, wholeR06: false, crossStoreAtomicity: false });
const STATUSES = ["queued", "waiting-dependency", "leased", "running", "waiting-connectivity", "waiting-resource", "ready-to-publish", "retrying", "completed", "failed", "cancelled"];
const TERMINAL = ["completed", "failed", "cancelled"];
const TASK_KEYS = "id idempotencyKey type payload status priority requiredCapabilities dependsOn attempts maxAttempts migrationClass pinnedNodeId waitReason executionEpoch leaseOwner leaseUntil fencingToken nextAttemptAt checkpointRef result error createdAt updatedAt history".split(" ");
const TASK_REQUIRED = "id idempotencyKey type payload status priority requiredCapabilities dependsOn attempts maxAttempts migrationClass executionEpoch createdAt updatedAt history".split(" ");
const RUNTIME = "status attempts executionEpoch leaseOwner leaseUntil fencingToken nextAttemptAt waitReason result error updatedAt history".split(" ");
const CAPSULE = "goal currentJob why workflowPosition inputs constraints decisions dependencies expectedOutput definitionOfDone verificationContract recoveryContext".split(" ");
const RESULT_KEYS = "sha256 bytes nodeId goalIssue verified issuer executionEpoch observedAt".split(" ");
const SIGNED_KEYS = "nodeId timestamp nonce method path bodySha256 signatureBase64".split(" ");
const RECEIVE_PATH = "/api/jarvis/worker/pc/observation/receive";
function fail(code) { const error = new Error(code); error.code = code; ownErrors.add(error); throw error; }
function requireValue(value, code = "PC_PAYLOAD_INVALID") { if (!value) fail(code); }
function object(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function shape(v, allowed, required = allowed) { return object(v) && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k)); }
function text(v, max = 16_384) { return typeof v === "string" && v.length > 0 && v.length <= max; }
function date(v) { return text(v, 30) && Number.isFinite(Date.parse(v)); }
function integer(v) { return Number.isSafeInteger(v) && v >= 0; }
function hex(v, n = 64) { return typeof v === "string" && new RegExp(`^[a-f0-9]{${n}}$`).test(v); }
function node(v) { return v === "macbook" || v === "zbook"; }
function hash(v) { return createHash("sha256").update(v).digest("hex"); }
function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (object(v)) return "{" + Object.keys(v).sort((a, b) => a.localeCompare(b)).map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function same(a, b) { return canonical(a) === canonical(b); }
function omit(v, keys) { return Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k))); }
function tree(v, depth = 0) {
  requireValue(depth <= 40);
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") { requireValue(Number.isFinite(v)); return; }
  requireValue(object(v) || Array.isArray(v));
  for (const child of Object.values(v)) tree(child, depth + 1);
}
function parse(raw, pretty = false) {
  let value;
  try { value = JSON.parse(raw); } catch { fail("PC_PAYLOAD_INVALID"); }
  // These are the actual store/client writer forms. Equality also rejects
  // duplicate object properties, lossy numbers and noncanonical UTF-8 input.
  requireValue(raw === (pretty ? JSON.stringify(value, null, 2) + "\n" : JSON.stringify(value)));
  tree(value); return value;
}
function binding(path, options) {
  const code = "PC_OPTIONS_INVALID";
  requireValue(typeof path === "string" && isAbsolute(path) && !path.includes("\0") && shape(options, ["profile", "expectedTaskFile", "expectedObservationFile"]) && options.profile === PROFILE && ["present", "absent"].includes(options.expectedTaskFile) && ["present", "absent"].includes(options.expectedObservationFile), code);
  return { path: resolve(path), ...options };
}
function fileIdentity(s) { return [s.dev, s.ino, s.nlink, s.size, s.mtimeNs, s.ctimeNs].map(String).join(":"); }
function regular(s) { return s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.size > 0n && s.size <= BigInt(MAX_BYTES); }
function read(path, expectation) {
  let fd;
  try {
    let initial;
    try { initial = lstatSync(path, { bigint: true }); }
    catch (error) { if (error.code === "ENOENT" && expectation === "absent") return null; throw error; }
    requireValue(regular(initial) && resolve(realpathSync(path)) === resolve(path), "PC_FILE_UNAVAILABLE");
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd, { bigint: true });
    requireValue(regular(opened) && fileIdentity(initial) === fileIdentity(opened), "PC_FILE_UNAVAILABLE");
    const bytes = Buffer.alloc(Number(opened.size) + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    requireValue(length === Number(opened.size) && fileIdentity(opened) === fileIdentity(fstatSync(fd, { bigint: true })) && fileIdentity(opened) === fileIdentity(lstatSync(path, { bigint: true })) && resolve(realpathSync(path)) === resolve(path), "PC_FILE_UNAVAILABLE");
    const value = bytes.subarray(0, length).toString("utf8");
    requireValue(Buffer.from(value, "utf8").equals(bytes.subarray(0, length)));
    return parse(value, true);
  } catch (error) { if (ownErrors.has(error)) throw error; fail("PC_FILE_UNAVAILABLE"); }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* never expose native errors */ } } }
}
function validateWork(p) {
  requireValue(shape(p, ["idempotencyKey", "goalIssue", "targetNodeId", "privacyClass", "content", "capsule"], ["idempotencyKey", "goalIssue", "privacyClass", "content", "capsule"]) && typeof p.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{1,150}$/.test(p.idempotencyKey) && integer(p.goalIssue) && p.goalIssue > 0 && p.privacyClass === "PUBLIC" && typeof p.content === "string" && Buffer.byteLength(p.content) <= 32768);
  requireValue(p.targetNodeId === undefined || typeof p.targetNodeId === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(p.targetNodeId));
  const c = p.capsule;
  requireValue(shape(c, CAPSULE) && Buffer.byteLength(JSON.stringify(c)) <= 16384 && c.goal === `#${p.goalIssue}`);
  for (const k of ["goal", "currentJob", "why", "workflowPosition", "verificationContract"]) requireValue(text(c[k]) && c[k].trim());
  for (const k of ["inputs", "constraints", "decisions", "dependencies", "expectedOutput", "definitionOfDone", "recoveryContext"]) requireValue(Array.isArray(c[k]) && c[k].length <= 1000 && c[k].every(v => typeof v === "string" && v.length <= 16384));
}
function validateResult(r, task, observation = false) {
  requireValue(shape(r, RESULT_KEYS) && hex(r.sha256) && r.sha256 === hash(task.payload.content) && r.bytes === Buffer.byteLength(task.payload.content) && text(r.nodeId, 100) && r.goalIssue === task.payload.goalIssue && r.verified === true && r.issuer === "signed-worker-request" && r.executionEpoch === task.executionEpoch && r.executionEpoch > 0 && date(r.observedAt) && (!task.payload.targetNodeId || task.payload.targetNodeId === r.nodeId) && (!observation || node(r.nodeId)));
}
function validTransition(from, to) {
  if (from === null) return to === "queued";
  if (TERMINAL.includes(from)) return false;
  if (to === "cancelled") return true;
  if (from === "queued" || from === "retrying") return ["leased", "waiting-dependency", "waiting-connectivity", "waiting-resource", "failed"].includes(to);
  if (from === "leased") return ["running", "completed", "ready-to-publish", "retrying", "failed", "waiting-connectivity", "waiting-resource"].includes(to);
  if (from === "running") return ["completed", "ready-to-publish", "retrying", "failed", "waiting-connectivity", "waiting-resource"].includes(to);
  if (from === "ready-to-publish") return to === "completed";
  return ["queued", "failed", "retrying"].includes(to);
}
function validateTask(t) {
  requireValue(shape(t, TASK_KEYS, TASK_REQUIRED)); validateWork(t.payload);
  requireValue(t.id === "pc-" + hash(`${t.payload.goalIssue}:${t.payload.idempotencyKey}`) && t.idempotencyKey === t.id && t.type === "pc-public-file-sha256" && same(t.requiredCapabilities, ["filesystem"]) && same(t.dependsOn, []) && t.migrationClass === "RESTARTABLE" && t.pinnedNodeId === undefined && t.maxAttempts === 3 && ["urgent", "high", "normal", "low", "background"].includes(t.priority) && STATUSES.includes(t.status) && integer(t.attempts) && t.attempts <= t.maxAttempts && integer(t.executionEpoch) && date(t.createdAt) && date(t.updatedAt) && Date.parse(t.updatedAt) >= Date.parse(t.createdAt));
  requireValue(Array.isArray(t.history) && t.history.length > 0 && t.history.length <= 10000);
  let previous = null, at = Date.parse(t.createdAt), leases = 0, leaseActor = null, leaseEpoch = 0;
  for (const e of t.history) {
    requireValue(shape(e, ["from", "to", "at", "reason", "actor", "evidence"], ["from", "to", "at", "reason"]) && e.from === previous && validTransition(e.from, e.to) && date(e.at) && Date.parse(e.at) >= at && text(e.reason) && (e.actor === undefined || text(e.actor, 200)) && (e.evidence === undefined || object(e.evidence)));
    if (e.to === "leased") { leases++; requireValue(text(e.actor, 200)); leaseActor = e.actor; leaseEpoch = leases; }
    if (e.to === "running") requireValue(leaseActor !== null && e.actor === leaseActor);
    if (["leased", "running"].includes(e.from) && e.actor !== undefined) requireValue(e.actor === leaseActor);
    // The legacy owner-based runtime omits evidence; claimed transitions carry
    // the current epoch. Neither form may contradict the history's live lease.
    if (e.evidence && Object.hasOwn(e.evidence, "executionEpoch")) requireValue(leaseActor !== null && e.evidence.executionEpoch === leaseEpoch);
    if (!["leased", "running"].includes(e.to)) leaseActor = null;
    previous = e.to; at = Date.parse(e.at);
  }
  requireValue(previous === t.status && t.history[0].at === t.createdAt && at <= Date.parse(t.updatedAt) && t.attempts === leases && t.executionEpoch === leases);
  const active = ["leased", "running"].includes(t.status);
  requireValue(active ? text(t.leaseOwner, 200) && text(t.fencingToken, 200) && date(t.leaseUntil) && leases > 0 && leaseActor === t.leaseOwner && leaseEpoch === t.executionEpoch : t.leaseOwner === undefined && t.leaseUntil === undefined && t.fencingToken === undefined);
  requireValue(t.nextAttemptAt === undefined || date(t.nextAttemptAt));
  requireValue(t.checkpointRef === undefined || text(t.checkpointRef));
  requireValue(t.error === undefined || text(t.error));
  requireValue(t.waitReason === undefined || ["connectivity", "resource", "pinned-node", "migration-checkpoint", "side-effect-reconciliation"].includes(t.waitReason));
  if (t.status === "completed") {
    validateResult(t.result, t);
    const last = t.history.at(-1); requireValue(last.actor === t.result.nodeId && last.at === t.result.observedAt && last.evidence?.executionEpoch === t.executionEpoch && t.history.findLast(e => e.to === "leased")?.actor === t.result.nodeId);
  } else requireValue(t.result === undefined);
}
function validateTasks(s) {
  if (s === null) return;
  requireValue(shape(s, ["version", "tasks", "savedAt"]) && s.version === 1 && date(s.savedAt) && Array.isArray(s.tasks) && s.tasks.length <= 10000);
  s.tasks.forEach(validateTask); requireValue(new Set(s.tasks.map(t => t.id)).size === s.tasks.length);
}
function validateObservation(o) {
  const keys = "version id idempotencyKey type payload migrationClass requiredCapabilities status executionEpoch sequence claim result".split(" ");
  requireValue(shape(o, keys, keys.filter(k => !["claim", "result"].includes(k))) && Buffer.byteLength(JSON.stringify(o)) <= 65536);
  validateWork(o.payload);
  requireValue(o.version === 1 && o.payload.goalIssue === 1219 && (!o.payload.targetNodeId || node(o.payload.targetNodeId)) && o.id === "pc-" + hash(`${o.payload.goalIssue}:${o.payload.idempotencyKey}`) && o.idempotencyKey === o.id && o.type === "pc-public-file-sha256" && o.migrationClass === "RESTARTABLE" && same(o.requiredCapabilities, ["filesystem"]) && STATUSES.includes(o.status) && integer(o.executionEpoch) && integer(o.sequence) && o.sequence >= 1);
  if (["leased", "running"].includes(o.status)) {
    const c = o.claim;
    requireValue(shape(c, ["taskId", "owner", "epoch", "fencingToken", "leaseUntil"]) && c.taskId === o.id && node(c.owner) && c.epoch === o.executionEpoch && c.epoch > 0 && typeof c.fencingToken === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(c.fencingToken) && date(c.leaseUntil) && (!o.payload.targetNodeId || o.payload.targetNodeId === c.owner));
  } else requireValue(o.claim === undefined);
  if (o.status === "completed") validateResult(o.result, o, true); else requireValue(o.result === undefined);
}
function validateVariant(v, taskId) {
  requireValue(shape(v, ["digest", "sourceNodeId", "observation", "provenance"]) && hex(v.digest) && node(v.sourceNodeId));
  validateObservation(v.observation); requireValue(v.observation.id === taskId && hash(canonical(v.observation)) === v.digest);
  const p = v.provenance;
  requireValue(shape(p, ["rawBody", "signed", "identity"]) && typeof p.rawBody === "string" && Buffer.byteLength(p.rawBody) <= 65536);
  const body = parse(p.rawBody), s = p.signed, i = p.identity;
  requireValue(shape(body, ["taskId", "revision", "sourceNodeId", "observation"]) && body.taskId === taskId && hex(body.revision, 40) && body.sourceNodeId === v.sourceNodeId && same(body.observation, v.observation));
  requireValue(shape(s, SIGNED_KEYS) && s.nodeId === v.sourceNodeId && date(s.timestamp) && text(s.nonce) && s.method === "POST" && s.path === RECEIVE_PATH && s.bodySha256 === hash(p.rawBody) && typeof s.signatureBase64 === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(s.signatureBase64));
  requireValue(shape(i, ["nodeId", "publicKeyPem", "enrolledAt", "algorithm", "revokedAt"], ["nodeId", "publicKeyPem", "enrolledAt"]) && i.nodeId === v.sourceNodeId && text(i.publicKeyPem) && date(i.enrolledAt) && i.algorithm === "ed25519" && i.revokedAt === undefined);
  try {
    const key = createPublicKey(i.publicKeyPem), sig = Buffer.from(s.signatureBase64, "base64");
    requireValue(key.asymmetricKeyType === "ed25519" && sig.length === 64 && sig.toString("base64") === s.signatureBase64 && verify(null, Buffer.from([s.nodeId, s.timestamp, s.nonce, s.method, s.path, s.bodySha256].join("\n")), key, sig));
  } catch (error) { if (ownErrors.has(error)) throw error; fail("PC_PAYLOAD_INVALID"); }
  // Historical signatures are checked cryptographically, without current-time
  // freshness/replay side effects or granting a new execution claim.
}
function incompatible(a, b) {
  const x = a.observation, y = b.observation;
  if (!same(x.payload, y.payload)) return true;
  if (a.sourceNodeId === b.sourceNodeId && x.sequence === y.sequence && a.digest !== b.digest) return true;
  const terminal = o => TERMINAL.includes(o.status);
  if (a.sourceNodeId === b.sourceNodeId && x.sequence !== y.sequence) {
    const [older, newer] = x.sequence < y.sequence ? [x, y] : [y, x];
    if (newer.executionEpoch < older.executionEpoch || terminal(older) && (older.status !== newer.status || older.executionEpoch !== newer.executionEpoch || !same(older.result, newer.result))) return true;
  }
  if (x.executionEpoch !== y.executionEpoch) return a.sourceNodeId !== b.sourceNodeId && !!(x.claim || y.claim || x.result || y.result || terminal(x) || terminal(y));
  if (x.claim && y.claim && (x.claim.owner !== y.claim.owner || x.claim.fencingToken !== y.claim.fencingToken)) return true;
  if (x.result && y.result && !same(x.result, y.result)) return true;
  if (x.claim && y.result && x.claim.owner !== y.result.nodeId || y.claim && x.result && y.claim.owner !== x.result.nodeId) return true;
  if (terminal(x) && terminal(y) && x.status !== y.status) return true;
  return a.sourceNodeId !== b.sourceNodeId && terminal(x) !== terminal(y) && !!(x.claim || y.claim);
}
function validateObservations(s) {
  if (s === null) return;
  requireValue(shape(s, ["version", "records", "savedAt"]) && s.version === 1 && date(s.savedAt) && Array.isArray(s.records) && s.records.length <= 64);
  for (const r of s.records) {
    requireValue(shape(r, ["recordId", "entityType", "version", "deviceId", "updatedAt", "clock", "syncState", "ownerTaskId", "verification", "value"]) && text(r.recordId) && r.entityType === "evidence" && r.deviceId === "pc-observation-adapter" && r.ownerTaskId === r.recordId && r.syncState === "pending-push" && date(r.updatedAt) && integer(r.version) && r.version > 0 && shape(r.clock, ["pc-observation-adapter"]) && r.clock["pc-observation-adapter"] === r.version && same(r.verification, { status: "unverified" }));
    const b = r.value;
    requireValue(shape(b, ["version", "taskId", "conflicted", "variants"]) && b.version === 1 && b.taskId === r.recordId && typeof b.conflicted === "boolean" && Array.isArray(b.variants) && b.variants.length > 0 && b.variants.length <= 16 && r.version === b.variants.length);
    b.variants.forEach(v => validateVariant(v, r.recordId));
    requireValue(new Set(b.variants.map(v => v.sourceNodeId + ":" + v.digest)).size === b.variants.length);
    requireValue(b.conflicted || !b.variants.some((v, i) => b.variants.slice(i + 1).some(w => incompatible(v, w))));
  }
  requireValue(new Set(s.records.map(r => r.recordId)).size === s.records.length);
}
function data(handle) { requireValue(object(handle) && snapshots.has(handle), "PC_HANDLE_INVALID"); return snapshots.get(handle); }
/** Caller verifies owner-local file protection and native approval separately.
 * These independent reads do not prove a cross-store transaction or quiescence.
 * Expected absence is an explicit baseline policy; later creation is allowed.
 */
export function capturePcSidecarSnapshot(dbPath, options) {
  const bound = binding(dbPath, options);
  const tasks = read(bound.path + ".pc-tasks.json", bound.expectedTaskFile);
  const observations = read(bound.path + ".pc-observations.json", bound.expectedObservationFile);
  validateTasks(tasks); validateObservations(observations);
  const handle = Object.freeze(Object.create(null)); snapshots.set(handle, { bound, tasks, observations }); return handle;
}
export function pcSidecarSummary(handle) {
  const s = data(handle);
  return Object.freeze({ profile: PROFILE, taskFilePresent: s.tasks !== null, observationFilePresent: s.observations !== null, taskCount: s.tasks?.tasks.length ?? 0, observationCount: s.observations?.records.length ?? 0, variantCount: s.observations?.records.reduce((n, r) => n + r.value.variants.length, 0) ?? 0, coverage: COVERAGE });
}
function prefix(a, b) { return b.length >= a.length && a.every((v, i) => same(v, b[i])); }
function taskProgress(a, b) {
  if (Date.parse(b.updatedAt) < Date.parse(a.updatedAt) || b.attempts < a.attempts || b.executionEpoch < a.executionEpoch) return false;
  if (TERMINAL.includes(a.status)) return same(a, b);
  if (a.history.length === b.history.length) {
    if (!same(omit(a, ["updatedAt", "leaseUntil"]), omit(b, ["updatedAt", "leaseUntil"]))) return false;
    return a.leaseUntil === b.leaseUntil || ["leased", "running"].includes(a.status) && Date.parse(b.leaseUntil) >= Date.parse(a.leaseUntil);
  }
  const leases = b.history.slice(a.history.length).filter(e => e.to === "leased").length;
  if (b.attempts - a.attempts !== leases || b.executionEpoch - a.executionEpoch !== leases) return false;
  if (["leased", "running"].includes(a.status) && ["leased", "running"].includes(b.status) && leases === 0 && (a.leaseOwner !== b.leaseOwner || a.fencingToken !== b.fencingToken || Date.parse(b.leaseUntil) < Date.parse(a.leaseUntil))) return false;
  return true;
}
export function comparePcSidecarSnapshots(beforeHandle, afterHandle) {
  const a = data(beforeHandle), b = data(afterHandle), reasons = [];
  const bindingMatched = same(a.bound, b.bound);
  const baselinePresenceMatched = (a.tasks !== null) === (a.bound.expectedTaskFile === "present") && (a.observations !== null) === (a.bound.expectedObservationFile === "present");
  const taskFilesRetained = a.tasks === null || b.tasks !== null;
  const observationFilesRetained = a.observations === null || b.observations !== null;
  const oldTasks = a.tasks?.tasks ?? [], newTasks = b.tasks?.tasks ?? [], tm = new Map(newTasks.map(t => [t.id, t]));
  const taskContractsPreserved = taskFilesRetained && oldTasks.every(t => tm.has(t.id) && same(omit(t, RUNTIME), omit(tm.get(t.id), RUNTIME)));
  const taskHistoryPreserved = taskFilesRetained && oldTasks.every(t => tm.has(t.id) && prefix(t.history, tm.get(t.id).history));
  const taskRuntimeValid = oldTasks.every(t => tm.has(t.id) && taskProgress(t, tm.get(t.id)));
  const oldRecords = a.observations?.records ?? [], newRecords = b.observations?.records ?? [], rm = new Map(newRecords.map(r => [r.recordId, r]));
  const observationProvenancePreserved = observationFilesRetained && oldRecords.every(r => {
    const n = rm.get(r.recordId);
    return n && same(omit(r, ["version", "updatedAt", "clock", "value"]), omit(n, ["version", "updatedAt", "clock", "value"])) && prefix(r.value.variants, n.value.variants) && (!r.value.conflicted || n.value.conflicted) && n.version >= r.version && Date.parse(n.updatedAt) >= Date.parse(r.updatedAt) && (n.version > r.version || same(r, n));
  });
  for (const [valid, code] of [[bindingMatched, "PC_BINDING_CHANGED"], [baselinePresenceMatched, "PC_BASELINE_PRESENCE_MISMATCH"], [taskContractsPreserved, "PC_TASK_CONTRACT_CHANGED"], [taskHistoryPreserved, "PC_TASK_HISTORY_LOST"], [taskRuntimeValid, "PC_TASK_RUNTIME_UNSUPPORTED"], [observationProvenancePreserved, "PC_OBSERVATION_PROVENANCE_CHANGED"]]) if (!valid) reasons.push(code);
  const operationalChanges = Object.freeze({ tasksAdded: newTasks.filter(t => !oldTasks.some(o => o.id === t.id)).length, tasksAdvanced: oldTasks.filter(t => tm.has(t.id) && !same(t, tm.get(t.id))).length, recordsAdded: newRecords.filter(r => !oldRecords.some(o => o.recordId === r.recordId)).length, variantsAdded: newRecords.reduce((n, r) => n + Math.max(0, r.value.variants.length - (oldRecords.find(o => o.recordId === r.recordId)?.value.variants.length ?? 0)), 0) });
  return Object.freeze({ status: reasons.length ? "FAIL" : "PASS", bindingMatched, taskContractsPreserved, taskHistoryPreserved, observationProvenancePreserved, operationalChanges, reasonCodes: Object.freeze(reasons), coverage: COVERAGE });
}
