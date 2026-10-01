import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { CompassStore } from "../compass/store.ts";
import { JarvisSqliteStateStore } from "./sqlite-state-store.ts";
import { validatePcEnrollmentApproval, type PcEnrollmentApproval } from "./pc-enrollment.ts";

export function preparePcRuntimeConfiguration<T extends { version: number; commit: string; releaseRoot: string; environment: Record<string, unknown> }>(input: {
  current: T; previousRevision: string; revision: string; releaseRoot: string;
  approval: PcEnrollmentApproval; now?: Date;
}): T {
  const approval = validatePcEnrollmentApproval(input.approval, input.now);
  const { current, previousRevision, revision, releaseRoot } = input;
  const native = (root: string, sha: string) => win32.isAbsolute(root) &&
    /^[A-Za-z]:\\Users\\[^\\]+\\JARVIS\\releases\\[a-f0-9]{40}$/i.test(root) &&
    win32.basename(root) === sha;
  if (approval.issue !== 1662 || approval.goalIssue !== 1219 ||
    !approval.targets.some(t => t.nodeId === "zbook" && t.platform === "windows") ||
    current.version !== 1 || !/^[a-f0-9]{40}$/.test(previousRevision) || !/^[a-f0-9]{40}$/.test(revision) ||
    current.commit !== previousRevision || !native(current.releaseRoot, previousRevision) || !native(releaseRoot, revision) ||
    win32.dirname(current.releaseRoot).toLowerCase() !== win32.dirname(releaseRoot).toLowerCase() ||
    !current.environment || typeof current.environment !== "object" || Array.isArray(current.environment)) {
    throw new Error("PC_RUNTIME_CONFIGURATION_REJECTED");
  }
  return { ...structuredClone(current), commit: revision, releaseRoot };
}

function schema(db: DatabaseSync) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(row => ({ ...row, sql: String(row.sql).replace(/\s+/g, " ").trim() }));
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** Production handles are read-only. Constructors run exclusively against owned memory fixtures. */
export function inspectPcRuntimeState(input: { brokerPath: string; compassPath: string; expectedAndroidCount?: number }) {
  const fixture = mkdtempSync(join(tmpdir(), "goriq-schema-"));
  let broker: DatabaseSync | undefined, compass: DatabaseSync | undefined;
  try {
    const brokerFixturePath = join(fixture, "broker.sqlite"), compassFixturePath = join(fixture, "compass.sqlite");
    new JarvisSqliteStateStore(brokerFixturePath).close(); new CompassStore(compassFixturePath).close();
    const fixtureSchemas = [brokerFixturePath, compassFixturePath].map(path => {
      const db = new DatabaseSync(path, { readOnly: true });
      try { return schema(db); } finally { db.close(); }
    });
    try {
      broker = new DatabaseSync(input.brokerPath, { readOnly: true, timeout: 5_000 });
      compass = new DatabaseSync(input.compassPath, { readOnly: true, timeout: 5_000 });
      broker.exec("BEGIN"); compass.exec("BEGIN");
      if (!isDeepStrictEqual(schema(broker), fixtureSchemas[0]) || !isDeepStrictEqual(schema(compass), fixtureSchemas[1])) {
        throw new Error("PC_RUNTIME_SCHEMA_MISMATCH");
      }
    } catch { throw new Error("PC_RUNTIME_SCHEMA_MISMATCH"); }
    const row = broker.prepare("SELECT payload FROM jarvis_state WHERE id=1").get() as { payload: string } | undefined;
    if (!row) throw new Error("PC_RUNTIME_FLEET_MISMATCH");
    const snapshot = JSON.parse(row.payload);
    const identities = broker.prepare("SELECT node_id,payload FROM jarvis_worker_identity ORDER BY node_id").all()
      .map(row => ({ nodeId: String(row.node_id), identity: JSON.parse(String(row.payload)) }));
    if (!Array.isArray(snapshot.fleet) || !Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.activeTakeovers)) throw new Error("PC_RUNTIME_FLEET_MISMATCH");
    const android = snapshot.fleet.filter((n: { kind: string }) => n.kind === "android");
    if (android.length !== (input.expectedAndroidCount ?? 38) ||
      new Set(snapshot.fleet.map((n: { id: string }) => n.id)).size !== snapshot.fleet.length ||
      android.some((n: { id: string }) => !identities.some(i => i.nodeId === n.id && i.identity.nodeId === n.id &&
        typeof i.identity.publicKeyPem === "string"))) throw new Error("PC_RUNTIME_FLEET_MISMATCH");
    const compassRows = compass.prepare("SELECT * FROM state ORDER BY project_id").all();
    for (const state of compassRows) {
      const active = JSON.parse(String(state.active));
      if (!Array.isArray(active)) throw new Error("PC_RUNTIME_QUIESCENCE_UNPROVEN");
      if (active.some(entry => entry?.kind === "jarvis-work-runs" &&
        (!Array.isArray(entry.runs) || entry.runs.some((run: { phase: string }) =>
          !["COMPLETED", "FAILED"].includes(run.phase))))) throw new Error("PC_RUNTIME_QUIESCENCE_REQUIRED");
    }
    if (snapshot.tasks.some((task: { status: string }) => !["completed", "failed", "cancelled"].includes(task.status)) || snapshot.activeTakeovers.length) {
      throw new Error("PC_RUNTIME_QUIESCENCE_REQUIRED");
    }
    // Private snapshot is host-local recovery/comparison input, never console output.
    const compassRecords = ["goal", "state", "verification", "history"].map(table =>
      ({ table, rows: compass!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() }));
    const privateSnapshot = { snapshot, identities, compassRecords };
    return { privateSnapshot, metadata: { version: 1, androidCount: android.length, identityCount: identities.length,
      schemaCompatible: true, quiescent: true, fleetDigest: digest(android.map((node: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(node).filter(([key]) => !["status", "lastSeenAt", "telemetry"].includes(key))))
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(a.id).localeCompare(String(b.id)))),
      identityDigest: digest(identities), tasksDigest: digest(snapshot.tasks),
      schemaDigest: digest(fixtureSchemas), compassDigest: digest(compassRecords), readOnly: true } };
  } finally { broker?.close(); compass?.close(); rmSync(fixture, { recursive: true, force: true }); }
}
