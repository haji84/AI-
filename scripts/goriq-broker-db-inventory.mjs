import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function empty(label) {
  return {
    label,
    exists: false,
    bytes: 0,
    fleetCount: null,
    workerIdentityCount: null,
    snapshotUpdatedAt: null,
    sha256: null,
    error: null,
  };
}

export function inspectBrokerDatabase(label, path) {
  const result = empty(label);
  if (!path || !existsSync(path)) return result;
  try {
    const stat = statSync(path);
    result.exists = stat.isFile();
    result.bytes = result.exists ? stat.size : 0;
    if (!result.exists) return result;
    result.sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const stateTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jarvis_state'").get();
      if (stateTable) {
        const row = db.prepare("SELECT payload, updated_at FROM jarvis_state WHERE id = 1").get();
        if (row) {
          try {
            const snapshot = JSON.parse(String(row.payload));
            result.fleetCount = Array.isArray(snapshot?.fleet) ? snapshot.fleet.length : 0;
          } catch {
            result.fleetCount = null;
          }
          result.snapshotUpdatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
        } else {
          result.fleetCount = 0;
        }
      }
      const identityTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jarvis_worker_identity'").get();
      if (identityTable) {
        const row = db.prepare("SELECT COUNT(*) AS count FROM jarvis_worker_identity").get();
        result.workerIdentityCount = Number(row?.count ?? 0);
      } else {
        result.workerIdentityCount = 0;
      }
    } finally {
      db.close();
    }
  } catch {
    result.error = "unreadable";
  }
  return result;
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.path) return false;
    const key = resolve(candidate.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function defaultCandidates() {
  const home = homedir();
  const candidates = [];
  if (process.env.GORIQ_DB_CONFIGURED_PATH) {
    candidates.push({ label: "configured-production", path: process.env.GORIQ_DB_CONFIGURED_PATH });
  }
  if (process.platform === "darwin") {
    candidates.push(
      { label: "mac-persistent-state", path: join(process.env.GORIQ_STATE_ROOT || join(home, ".goriq", "state"), "jarvis.db") },
      { label: "mac-current-repo-default", path: join(process.cwd(), ".jarvis", "jarvis.db") },
      { label: "mac-canonical-repo-default", path: join(home, "JARVIS-AI-", ".jarvis", "jarvis.db") },
      { label: "mac-application-support", path: join(home, "Library", "Application Support", "JARVIS", "jarvis.db") },
      { label: "mac-gai-worker", path: join(home, "Library", "Application Support", "GAIWorker", "jarvis.db") },
    );
  } else if (process.platform === "win32") {
    candidates.push(
      { label: "windows-repo-default", path: join(process.cwd(), ".jarvis", "jarvis.db") },
      { label: "windows-production-default", path: join(home, "JARVIS", "production", "jarvis.db") },
    );
  }
  return uniqueCandidates(candidates);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const results = defaultCandidates().map(({ label, path }) => inspectBrokerDatabase(label, path));
  process.stdout.write(JSON.stringify({ platform: process.platform, candidates: results }, null, 2) + "\n");
}
