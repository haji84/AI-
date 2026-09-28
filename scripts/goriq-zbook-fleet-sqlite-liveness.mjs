import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next"]);
const MAX_FILES = 2000;
const MAX_DEPTH = 8;

function safeDateMs(value) {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function discoverDatabases(root) {
  const results = [];
  const stack = [{ path: root, depth: 0 }];
  let visitedFiles = 0;
  while (stack.length && visitedFiles < MAX_FILES) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visitedFiles >= MAX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const full = join(current.path, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) {
          stack.push({ path: full, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      visitedFiles++;
      if (DB_EXTENSIONS.has(extname(entry.name).toLowerCase())) results.push(full);
    }
  }
  return { paths: results, visitedFiles };
}

function inspectCandidate(path, nowMs, freshnessMs) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const stateTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jarvis_state'").get();
    const identityTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jarvis_worker_identity'").get();
    if (!stateTable || !identityTable) return null;
    const state = db.prepare("SELECT payload, updated_at FROM jarvis_state WHERE id=1").get();
    if (!state) return null;
    const identityCount = Number(db.prepare("SELECT COUNT(*) AS count FROM jarvis_worker_identity").get()?.count ?? 0);
    let snapshot;
    try {
      snapshot = JSON.parse(String(state.payload));
    } catch {
      return null;
    }
    const fleet = Array.isArray(snapshot?.fleet) ? snapshot.fleet : [];
    const android = fleet.filter((device) => device?.kind === "android");
    const ages = [];
    let fresh = 0;
    for (const device of android) {
      const seen = safeDateMs(device?.lastSeenAt);
      if (seen === null) continue;
      const age = Math.max(0, nowMs - seen);
      ages.push(age);
      if (age <= freshnessMs) fresh++;
    }
    return {
      fleetCount: fleet.length,
      workerIdentityCount: identityCount,
      androidRegistered: android.length,
      androidFresh: fresh,
      newestAndroidHeartbeatAgeMs: ages.length ? Math.min(...ages) : null,
      snapshotUpdatedAt: typeof state.updated_at === "string" ? state.updated_at : null,
      snapshotUpdatedAtMs: safeDateMs(state.updated_at),
    };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

export function scanZBookFleetDatabases(root, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const freshnessMs = options.freshnessMs ?? 60_000;
  const expectedFleet = options.expectedFleet ?? 38;
  const expectedIdentities = options.expectedIdentities ?? 38;
  const discovered = discoverDatabases(root);
  const matches = [];
  for (const path of discovered.paths) {
    const candidate = inspectCandidate(path, nowMs, freshnessMs);
    if (!candidate) continue;
    if (candidate.fleetCount === expectedFleet && candidate.workerIdentityCount === expectedIdentities) {
      matches.push(candidate);
    }
  }
  matches.sort((a, b) => (b.snapshotUpdatedAtMs ?? 0) - (a.snapshotUpdatedAtMs ?? 0));
  const chosen = matches[0] ?? null;
  return {
    ok: Boolean(chosen),
    reason: chosen ? "preserved_fleet_db_found" : "preserved_fleet_db_not_found",
    scannedDatabaseFiles: discovered.paths.length,
    matchingDatabases: matches.length,
    fleetCount: chosen?.fleetCount ?? null,
    workerIdentityCount: chosen?.workerIdentityCount ?? null,
    androidRegistered: chosen?.androidRegistered ?? null,
    androidFresh: chosen?.androidFresh ?? null,
    newestAndroidHeartbeatAgeMs: chosen?.newestAndroidHeartbeatAgeMs ?? null,
    freshnessMs,
    snapshotUpdatedAt: chosen?.snapshotUpdatedAt ?? null,
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = join(homedir(), "JARVIS");
  const result = scanZBookFleetDatabases(root);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.ok ? 0 : 1);
}
