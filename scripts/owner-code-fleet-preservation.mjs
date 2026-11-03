import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PROFILE = "jarvis-control-plane-sqlite-v1";
const snapshots = new WeakMap();
const ownErrors = new WeakSet();
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const COVERAGE = Object.freeze({ fleetSqlite: true, workerPublicKeys: true, workerLifecycleHistory: true, retainedAudit: true, taskQueuePayloads: true, workerPrivateKeys: false, pcTaskSidecars: false, compassHistory: false, wholeR06: false });
const TABLE_SQL = {
  jarvis_state: "CREATE TABLE jarvis_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT",
  jarvis_worker_identity: "CREATE TABLE jarvis_worker_identity (node_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT",
  jarvis_worker_nonce: "CREATE TABLE jarvis_worker_nonce (node_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (node_id, nonce)) STRICT",
};
const SCHEMA = {
  ...Object.fromEntries(Object.entries(TABLE_SQL).map(([name, sql]) => [name, { type: "table", table: name, sql }])),
  jarvis_worker_nonce_expires_at: { type: "index", table: "jarvis_worker_nonce", sql: "CREATE INDEX jarvis_worker_nonce_expires_at ON jarvis_worker_nonce (expires_at)" },
  sqlite_autoindex_jarvis_worker_identity_1: { type: "index", table: "jarvis_worker_identity", sql: null },
  sqlite_autoindex_jarvis_worker_nonce_1: { type: "index", table: "jarvis_worker_nonce", sql: null },
};
const NODE_KEYS = ["id", "label", "kind", "status", "capabilities", "policy", "telemetry", "nodeContract", "pcAuthority", "enrollment", "fleetNumber", "group", "lastSeenAt"];
const TELEMETRY_KEYS = ["remoteProtocol", "androidApi", "batteryPercent", "charging", "temperatureC", "freeStorageMb", "cpuLoadPercent", "gpuLoadPercent", "memoryAvailableMb", "cpuAvailable", "gpuAvailable", "onExternalPower", "thermalState", "dataLocalityKeys", "network", "deviceOwner", "adminActive", "accessibilityEnabled", "locked", "screenInteractive", "checkedAt"];
const TASK_KEYS = ["id", "idempotencyKey", "type", "payload", "status", "requiredCapabilities", "preferredKinds", "resourceRequirements", "priority", "requiresOnline", "targetNodeId", "assignedNodeId", "leaseUntil", "dispatchBefore", "attempts", "maxAttempts", "createdAt", "updatedAt"];
const TASK_RUNTIME = ["status", "assignedNodeId", "leaseUntil", "attempts", "updatedAt"];
const KINDS = ["android", "ios", "windows", "macos", "linux", "cloud"];
const CAPABILITIES = ["browser", "open-url", "open-app", "launch-settings", "device-status", "show-notification", "lock-device", "reboot", "device-owner", "ui-automation", "self-update", "filesystem", "windows-tooling", "camera", "gps", "bluetooth", "local-model", "speech-to-text", "text-to-speech", "gpu", "remote-view", "remote-control", "wake-device", "background-worker", "long-running"];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  ownErrors.add(error);
  throw error;
}
function requireValue(condition, code = "FLEET_PAYLOAD_INVALID") { if (!condition) fail(code); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value, allowed, required = []) {
  return object(value) && Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}
function string(value) { return typeof value === "string" && value.length > 0 && value.length <= 16_384; }
function date(value) { return string(value) && Number.isFinite(Date.parse(value)); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function strings(value, allowed) { return Array.isArray(value) && value.length <= 1000 && value.every((item) => string(item) && (!allowed || allowed.includes(item))) && new Set(value).size === value.length; }
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (object(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function same(left, right) { return canonical(left) === canonical(right); }
function omit(value, excluded) { return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.includes(key))); }
function jsonTree(value, depth = 0) {
  requireValue(depth <= 40);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { requireValue(Number.isFinite(value)); return; }
  requireValue(Array.isArray(value) || object(value));
  for (const child of Object.values(value)) jsonTree(child, depth + 1);
}
function parsePayload(raw) {
  requireValue(typeof raw === "string" && Buffer.byteLength(raw) <= MAX_JSON_BYTES);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail("FLEET_PAYLOAD_INVALID"); }
  // The canonical store writes JSON.stringify. Reject duplicate-key and unknown storage forms.
  requireValue(JSON.stringify(parsed) === raw);
  jsonTree(parsed);
  return parsed;
}
function optional(value, key, predicate) { return !Object.hasOwn(value, key) || predicate(value[key]); }
function uniqueIdArray(value, max) {
  requireValue(Array.isArray(value) && value.length <= max);
  requireValue(value.every((item) => object(item) && string(item.id)) && new Set(value.map((item) => item.id)).size === value.length);
}
function validateNode(node) {
  requireValue(keys(node, NODE_KEYS, ["id", "label", "kind", "status", "capabilities", "policy", "telemetry", "enrollment", "lastSeenAt"]));
  requireValue(string(node.label) && KINDS.includes(node.kind) && ["ready", "busy", "offline", "locked", "needs-human", "disabled"].includes(node.status));
  requireValue(strings(node.capabilities, CAPABILITIES) && ["quick", "full"].includes(node.enrollment) && date(node.lastSeenAt));
  const policy = node.policy;
  const policyKeys = ["allowPaidServices", "allowDestructiveActions", "allowExternalPublication", "allowRemoteControl", "requireHumanForLockedDevice"];
  requireValue(keys(policy, policyKeys, policyKeys) && policyKeys.every((key) => typeof policy[key] === "boolean") && policy.allowPaidServices === false);
  requireValue(keys(node.telemetry, TELEMETRY_KEYS, ["checkedAt"]) && date(node.telemetry.checkedAt));
  const booleanTelemetry = ["charging", "cpuAvailable", "gpuAvailable", "onExternalPower", "deviceOwner", "adminActive", "accessibilityEnabled", "locked", "screenInteractive"];
  for (const [key, value] of Object.entries(node.telemetry)) {
    if (key === "checkedAt") continue;
    requireValue(booleanTelemetry.includes(key) ? typeof value === "boolean" : key === "dataLocalityKeys" ? strings(value) : key === "network" ? ["wifi", "cellular", "lan", "offline"].includes(value) : key === "thermalState" ? ["nominal", "fair", "serious", "critical"].includes(value) : typeof value === "number" && Number.isFinite(value));
  }
  requireValue(optional(node, "fleetNumber", integer) && optional(node, "group", string));
  if (node.pcAuthority !== undefined) {
    const a = node.pcAuthority;
    requireValue(keys(a, ["version", "approvalIssue", "goalIssue", "roles", "capabilityCeiling"], ["version", "approvalIssue", "goalIssue", "roles", "capabilityCeiling"]) && a.version === 1 && integer(a.approvalIssue) && integer(a.goalIssue) && strings(a.roles, ["Executor", "Storage", "Verifier", "Coordinator"]) && strings(a.capabilityCeiling, CAPABILITIES));
  }
  if (node.nodeContract !== undefined) {
    const c = node.nodeContract;
    const fields = ["schemaVersion", "platform", "architecture", "executionModes", "networkRequirement", "persistence", "migration", "security", "constraints", "resources", "checkedAt"];
    requireValue(keys(c, fields, fields) && c.schemaVersion === 1 && c.platform === "android" && (c.architecture === null || string(c.architecture)) && strings(c.executionModes, ["foreground", "background-scheduled", "deferred"]) && c.executionModes.length > 0 && c.networkRequirement === "offline-capable" && date(c.checkedAt));
    for (const [key, fields] of [["persistence", ["localState", "checkpointResume", "offlineQueue"]], ["security", ["credentialIsolation", "taskScopedAuthorization"]], ["constraints", ["residentExecution", "lockedUiRequiresHuman"]]]) requireValue(keys(c[key], fields, fields) && fields.every((field) => typeof c[key][field] === "boolean"));
    requireValue(keys(c.migration, ["supported", "checkpointResume", "sideEffectingFencing"], ["supported", "checkpointResume", "sideEffectingFencing"]) && strings(c.migration.supported, ["RESTARTABLE", "PINNED"]) && typeof c.migration.checkpointResume === "boolean" && typeof c.migration.sideEffectingFencing === "boolean");
    requireValue(keys(c.resources, ["cpuCores", "memoryAvailableMb", "freeStorageMb", "batteryPercent", "charging", "network"]));
    for (const [key, value] of Object.entries(c.resources)) requireValue(key === "charging" ? typeof value === "boolean" : key === "network" ? ["wifi", "cellular", "lan", "offline"].includes(value) : typeof value === "number" && Number.isFinite(value));
  }
}
function validateState(state) {
  const fields = ["generatedAt", "fleet", "tasks", "activeTakeovers", "audit", "stats"];
  requireValue(keys(state, fields, fields) && date(state.generatedAt));
  uniqueIdArray(state.fleet, 100); state.fleet.forEach(validateNode);
  uniqueIdArray(state.tasks, 10_000);
  for (const task of state.tasks) {
    requireValue(keys(task, TASK_KEYS, ["id", "idempotencyKey", "type", "payload", "status", "requiredCapabilities", "priority", "requiresOnline", "attempts", "maxAttempts", "createdAt", "updatedAt"]));
    requireValue(string(task.idempotencyKey) && string(task.type) && object(task.payload) && strings(task.requiredCapabilities, CAPABILITIES) && ["urgent", "high", "normal", "low", "background"].includes(task.priority) && typeof task.requiresOnline === "boolean");
    requireValue(["queued", "leased", "running", "waiting-connectivity", "waiting-human", "completed", "failed", "cancelled"].includes(task.status) && integer(task.attempts) && integer(task.maxAttempts) && date(task.createdAt) && date(task.updatedAt));
    requireValue(optional(task, "preferredKinds", (v) => strings(v, KINDS)) && optional(task, "targetNodeId", string) && optional(task, "assignedNodeId", string) && optional(task, "leaseUntil", date) && optional(task, "dispatchBefore", date));
    if (task.resourceRequirements !== undefined) requireValue(object(task.resourceRequirements));
  }
  uniqueIdArray(state.audit, 1000);
  for (const event of state.audit) requireValue(keys(event, ["id", "at", "actor", "action", "target", "detail"], ["id", "at", "actor", "action"]) && date(event.at) && string(event.actor) && string(event.action) && optional(event, "target", string) && optional(event, "detail", object));
  uniqueIdArray(state.activeTakeovers, 10_000);
  for (const session of state.activeTakeovers) requireValue(keys(session, ["id", "nodeId", "taskId", "status", "reason", "lastAction", "currentUrl", "appName", "screenshotRef", "createdAt", "updatedAt"], ["id", "nodeId", "status", "reason", "createdAt", "updatedAt"]) && string(session.nodeId) && string(session.reason) && ["requested", "active", "resolved", "cancelled"].includes(session.status) && date(session.createdAt) && date(session.updatedAt) && ["taskId", "lastAction", "currentUrl", "appName", "screenshotRef"].every((key) => optional(session, key, string)));
  const stats = ["registered", "ready", "offline", "needsHuman", "queued", "running", "completed", "failed"];
  requireValue(keys(state.stats, stats, stats) && stats.every((key) => integer(state.stats[key])));
  const expected = { registered: state.fleet.length, ready: state.fleet.filter((n) => n.status === "ready").length, offline: state.fleet.filter((n) => n.status === "offline").length, needsHuman: state.fleet.filter((n) => ["needs-human", "locked"].includes(n.status)).length, queued: state.tasks.filter((task) => ["queued", "waiting-connectivity"].includes(task.status)).length, running: state.tasks.filter((task) => ["leased", "running"].includes(task.status)).length, completed: state.tasks.filter((task) => task.status === "completed").length, failed: state.tasks.filter((task) => task.status === "failed").length };
  requireValue(same(state.stats, expected));
}
function validateIdentity(row) {
  requireValue(string(row.node_id) && date(row.updated_at));
  const identity = parsePayload(row.payload);
  requireValue(keys(identity, ["nodeId", "publicKeyPem", "enrolledAt", "algorithm", "revokedAt"], ["nodeId", "publicKeyPem", "enrolledAt"]) && identity.nodeId === row.node_id && string(identity.publicKeyPem) && date(identity.enrolledAt) && optional(identity, "revokedAt", date));
  const algorithm = identity.algorithm ?? "ed25519";
  requireValue(["ed25519", "ecdsa-p256-sha256"].includes(algorithm));
  requireValue(!identity.revokedAt || Date.parse(identity.revokedAt) >= Date.parse(identity.enrolledAt));
  try {
    const key = createPublicKey(identity.publicKeyPem);
    requireValue(algorithm === "ed25519" ? key.asymmetricKeyType === "ed25519" : key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1");
  } catch { fail("FLEET_PAYLOAD_INVALID"); }
  return { nodeId: row.node_id, payload: identity, updatedAt: row.updated_at };
}
function normalizeSql(sql) { return sql === null ? null : sql.toLowerCase().replace(/\s+/g, "").replace("ifnotexists", "").replace(/;$/, ""); }
function validateSchema(db) {
  const rows = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  requireValue(rows.length === Object.keys(SCHEMA).length, "FLEET_SCHEMA_UNSUPPORTED");
  for (const row of rows) {
    const expected = SCHEMA[row.name];
    requireValue(expected && row.type === expected.type && row.tbl_name === expected.table && normalizeSql(row.sql) === normalizeSql(expected.sql), "FLEET_SCHEMA_UNSUPPORTED");
  }
  requireValue(db.prepare("PRAGMA user_version").get().user_version === 0 && db.prepare("PRAGMA application_id").get().application_id === 0, "FLEET_SCHEMA_UNSUPPORTED");
  const tables = db.prepare("PRAGMA table_list").all().filter((row) => Object.hasOwn(TABLE_SQL, row.name));
  requireValue(tables.length === 3 && tables.every((row) => row.strict === 1 && row.wr === 0), "FLEET_SCHEMA_UNSUPPORTED");
}
function boundOptions(path, options) {
  const code = "FLEET_OPTIONS_INVALID";
  const hex = (value, count) => typeof value === "string" && new RegExp(`^[a-f0-9]{${count}}$`).test(value);
  requireValue(typeof path === "string" && isAbsolute(path) && keys(options, ["schemaProfile", "databaseBinding", "cohortAuthority", "timeoutMs"], ["schemaProfile", "databaseBinding", "cohortAuthority"]) && options.schemaProfile === PROFILE, code);
  const binding = options.databaseBinding;
  requireValue(keys(binding, ["path", "configSha256", "taskSha256", "releaseRevision"], ["path", "configSha256", "taskSha256", "releaseRevision"]) && typeof binding.path === "string" && isAbsolute(binding.path) && resolve(binding.path) === resolve(path) && hex(binding.configSha256, 64) && hex(binding.taskSha256, 64) && hex(binding.releaseRevision, 40), code);
  const authority = options.cohortAuthority;
  requireValue(keys(authority, ["kind", "approvalSha256", "expectedCount", "cohortSha256"], ["kind", "approvalSha256", "expectedCount"]) && ["approved-active-capture", "original-cohort-digest"].includes(authority.kind) && hex(authority.approvalSha256, 64) && Number.isSafeInteger(authority.expectedCount) && authority.expectedCount > 0 && authority.expectedCount <= 100, code);
  requireValue(authority.kind === "original-cohort-digest" ? hex(authority.cohortSha256, 64) : !Object.hasOwn(authority, "cohortSha256"), code);
  requireValue(options.timeoutMs === undefined || Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 5000, code);
  return { binding: { ...binding }, authority: { ...authority }, timeout: options.timeoutMs ?? 5000 };
}
function fileBinding(path) {
  const stat = lstatSync(path, { bigint: true });
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && resolve(realpathSync(path)) === resolve(path), "FLEET_DATABASE_UNAVAILABLE");
  return { path: resolve(path), dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs) };
}
function data(handle) {
  requireValue(object(handle) && snapshots.has(handle), "FLEET_HANDLE_INVALID");
  return snapshots.get(handle);
}

/** The caller must verify the bound task/config and Owner approval before calling.
 * Neither an options object nor this SQLite-only proof grants native authority.
 * Read-only SQLite observes WAL and may use WAL shared-memory reader locks.
 */
export function captureFleetSnapshot(dbPath, options) {
  let db;
  let transaction = false;
  try {
    const bound = boundOptions(dbPath, options);
    const file = fileBinding(dbPath);
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: bound.timeout, allowExtension: false });
    db.exec("BEGIN"); transaction = true;
    validateSchema(db);
    const stateSizes = db.prepare("SELECT id,length(CAST(payload AS BLOB)) AS bytes FROM jarvis_state").all();
    requireValue(stateSizes.length === 1 && stateSizes[0].id === 1 && stateSizes[0].bytes <= MAX_JSON_BYTES);
    const identitySize = db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM jarvis_worker_identity").get();
    const nonceCount = db.prepare("SELECT COUNT(*) AS count FROM jarvis_worker_nonce").get().count;
    requireValue(identitySize.count <= 10_000 && identitySize.bytes <= MAX_JSON_BYTES && nonceCount <= 100_000);
    const row = db.prepare("SELECT id,payload,updated_at FROM jarvis_state WHERE id=1").get();
    requireValue(date(row.updated_at));
    const state = parsePayload(row.payload); validateState(state);
    const identities = db.prepare("SELECT node_id,payload,updated_at FROM jarvis_worker_identity ORDER BY node_id COLLATE BINARY").all().map(validateIdentity);
    const identityMap = new Map(identities.map((identity) => [identity.nodeId, identity]));
    requireValue(state.fleet.length === bound.authority.expectedCount && state.fleet.every((node) => identityMap.has(node.id) && !identityMap.get(node.id).payload.revokedAt), "FLEET_COHORT_INVALID");
    if (bound.authority.kind === "original-cohort-digest") requireValue(createHash("sha256").update(JSON.stringify(state.fleet.map((node) => node.id).sort())).digest("hex") === bound.authority.cohortSha256, "FLEET_COHORT_INVALID");
    const nonces = db.prepare("SELECT node_id,nonce,expires_at FROM jarvis_worker_nonce ORDER BY node_id COLLATE BINARY,nonce COLLATE BINARY").all();
    requireValue(nonces.every((nonce) => string(nonce.node_id) && string(nonce.nonce) && integer(nonce.expires_at)));
    db.exec("COMMIT"); transaction = false;
    requireValue(same(file, fileBinding(dbPath)), "FLEET_DATABASE_UNAVAILABLE");
    const handle = Object.freeze(Object.create(null));
    snapshots.set(handle, { state, identities, nonces, bound, file, capturedAt: Date.now() });
    return handle;
  } catch (error) {
    if (ownErrors.has(error)) throw error;
    fail("FLEET_DATABASE_UNAVAILABLE");
  } finally {
    if (transaction) { try { db.exec("ROLLBACK"); } catch { /* read transaction only */ } }
    try { db?.close(); } catch { /* no underlying errors leave the private process */ }
  }
}

export function fleetSnapshotSummary(handle) {
  const snapshot = data(handle);
  return Object.freeze({ schemaProfile: PROFILE, fleetCount: snapshot.state.fleet.length, identityCount: snapshot.identities.length, revokedIdentityCount: snapshot.identities.filter((identity) => identity.payload.revokedAt).length, taskCount: snapshot.state.tasks.length, auditCount: snapshot.state.audit.length, nonceCount: snapshot.nonces.length, cohortAuthorityVerified: true, coverage: COVERAGE });
}

function fleetStable(node) {
  const result = omit(node, ["status", "lastSeenAt", "telemetry"]);
  if (result.nodeContract) result.nodeContract = omit(result.nodeContract, ["checkedAt", "resources"]);
  return result;
}
function byId(values) { return new Map(values.map((value) => [value.id, value])); }
function preserved(before, after, projection = (value) => value) {
  const next = byId(after);
  return before.every((value) => next.has(value.id) && same(projection(value), projection(next.get(value.id))));
}
function changes(before, after) {
  const next = byId(after);
  return before.filter((value) => !next.has(value.id) || !same(value, next.get(value.id))).length + after.filter((value) => !before.some((old) => old.id === value.id)).length;
}

export function compareFleetSnapshots(beforeHandle, afterHandle) {
  const before = data(beforeHandle), after = data(afterHandle);
  const reasons = [];
  const databaseBindingMatched = same(before.bound.binding, after.bound.binding) && same(before.file, after.file);
  const cohortAuthorityVerified = same(before.bound.authority, after.bound.authority);
  const baselineCohortPreserved = before.state.fleet.length === after.state.fleet.length && preserved(before.state.fleet, after.state.fleet, (node) => node.id);
  const fleetMetadataPreserved = baselineCohortPreserved && preserved(before.state.fleet, after.state.fleet, fleetStable);
  const oldIdentities = before.identities.map((row) => ({ id: row.nodeId, ...row }));
  const newIdentities = after.identities.map((row) => ({ id: row.nodeId, ...row }));
  const identitiesPreserved = oldIdentities.length === newIdentities.length && preserved(oldIdentities, newIdentities);
  const keysPreserved = oldIdentities.length === newIdentities.length && preserved(oldIdentities, newIdentities, (row) => ({ id: row.id, publicKeyPem: row.payload.publicKeyPem, algorithm: row.payload.algorithm }));
  const workerLifecycleHistoryPreserved = oldIdentities.length === newIdentities.length && preserved(oldIdentities, newIdentities, (row) => ({ id: row.id, enrolledAt: row.payload.enrolledAt, revokedAt: row.payload.revokedAt }));
  const oldAudit = before.state.audit, newAudit = after.state.audit;
  const auditRetainedHistoryPreserved = newAudit.length >= oldAudit.length && oldAudit.every((event, index) => same(event, newAudit[index]));
  let auditRolled = false;
  if (!auditRetainedHistoryPreserved && oldAudit.length === 1000 && newAudit.length === 1000) {
    const shifted = oldAudit.findIndex((event) => event.id === newAudit[0].id);
    auditRolled = shifted > 0 && oldAudit.slice(shifted).every((event, index) => same(event, newAudit[index]));
    if (shifted < 0) auditRolled = !newAudit.some((event) => oldAudit.some((old) => old.id === event.id));
  }
  const afterTasks = byId(after.state.tasks);
  const taskPayloadsPreserved = preserved(before.state.tasks, after.state.tasks, (task) => omit(task, TASK_RUNTIME)) && before.state.tasks.every((task) => afterTasks.get(task.id).attempts >= task.attempts && Date.parse(afterTasks.get(task.id).updatedAt) >= Date.parse(task.updatedAt));
  const nonceKey = (nonce) => JSON.stringify([nonce.node_id, nonce.nonce]);
  const afterNonces = new Map(after.nonces.map((nonce) => [nonceKey(nonce), nonce]));
  const nonceProtectionPreserved = before.nonces.filter((nonce) => nonce.expires_at > after.capturedAt).every((nonce) => same(nonce, afterNonces.get(nonceKey(nonce))));
  const takeoversPreserved = preserved(before.state.activeTakeovers.filter((session) => after.state.activeTakeovers.some((next) => next.id === session.id)), after.state.activeTakeovers, (session) => omit(session, ["status", "lastAction", "currentUrl", "appName", "screenshotRef", "updatedAt"]));
  for (const [valid, code] of [[databaseBindingMatched, "FLEET_DATABASE_BINDING_CHANGED"], [cohortAuthorityVerified, "FLEET_COHORT_AUTHORITY_CHANGED"], [baselineCohortPreserved, "FLEET_COHORT_CHANGED"], [fleetMetadataPreserved, "FLEET_METADATA_CHANGED"], [identitiesPreserved, "FLEET_IDENTITIES_CHANGED"], [keysPreserved, "FLEET_KEYS_CHANGED"], [workerLifecycleHistoryPreserved, "FLEET_LIFECYCLE_CHANGED"], [taskPayloadsPreserved, "FLEET_TASK_PAYLOAD_CHANGED"], [nonceProtectionPreserved, "FLEET_LIVE_NONCE_LOST"], [takeoversPreserved, "FLEET_TAKEOVER_CHANGED"]]) if (!valid) reasons.push(code);
  if (!auditRetainedHistoryPreserved) reasons.push(auditRolled ? "FLEET_AUDIT_WINDOW_ROLLED" : "FLEET_AUDIT_CHANGED");
  const status = reasons.length === 0 ? "PASS" : reasons.length === 1 && auditRolled ? "INCONCLUSIVE" : "FAIL";
  return Object.freeze({ status, databaseBindingMatched, cohortAuthorityVerified, baselineCohortPreserved, fleetMetadataPreserved, identitiesPreserved, keysPreserved, workerLifecycleHistoryPreserved, auditRetainedHistoryPreserved, taskPayloadsPreserved, nonceProtectionPreserved, operationalChanges: Object.freeze({ fleet: changes(before.state.fleet, after.state.fleet), tasks: changes(before.state.tasks, after.state.tasks), nonces: before.nonces.filter((nonce) => !same(nonce, afterNonces.get(nonceKey(nonce)))).length + after.nonces.filter((nonce) => !before.nonces.some((old) => nonceKey(old) === nonceKey(nonce))).length, auditAppended: Math.max(0, newAudit.length - (auditRolled ? oldAudit.filter((event) => newAudit.some((next) => next.id === event.id)).length : oldAudit.length)), takeovers: changes(before.state.activeTakeovers, after.state.activeTakeovers) }), reasonCodes: Object.freeze(reasons), coverage: COVERAGE });
}
