import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { JarvisControlPlaneSnapshot } from "./control-plane.ts";
import type { JarvisWorkerIdentity } from "./worker-auth.ts";

interface SnapshotRow {
  payload: string;
}

interface IdentityRow {
  payload: string;
}

export class JarvisSqliteStateStore {
  private readonly db: DatabaseSync;

  constructor(path = resolve(process.cwd(), ".jarvis", "jarvis.db")) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS jarvis_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS jarvis_worker_identity (
        node_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  save(snapshot: JarvisControlPlaneSnapshot): void {
    this.db.prepare(`
      INSERT INTO jarvis_state (id, payload, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(JSON.stringify(snapshot), snapshot.generatedAt);
  }

  load(): JarvisControlPlaneSnapshot | undefined {
    const row = this.db.prepare("SELECT payload FROM jarvis_state WHERE id = 1").get() as SnapshotRow | undefined;
    if (!row) return undefined;
    return JSON.parse(row.payload) as JarvisControlPlaneSnapshot;
  }

  saveWorkerIdentity(identity: JarvisWorkerIdentity, now = new Date()): void {
    this.db.prepare(`
      INSERT INTO jarvis_worker_identity (node_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(identity.nodeId, JSON.stringify(identity), now.toISOString());
  }

  getWorkerIdentity(nodeId: string): JarvisWorkerIdentity | undefined {
    const row = this.db.prepare("SELECT payload FROM jarvis_worker_identity WHERE node_id = ?").get(nodeId) as IdentityRow | undefined;
    return row ? JSON.parse(row.payload) as JarvisWorkerIdentity : undefined;
  }

  listWorkerIdentities(): JarvisWorkerIdentity[] {
    const rows = this.db.prepare("SELECT payload FROM jarvis_worker_identity ORDER BY node_id").all() as unknown as IdentityRow[];
    return rows.map((row) => JSON.parse(row.payload) as JarvisWorkerIdentity);
  }

  revokeWorkerIdentity(nodeId: string, now = new Date()): JarvisWorkerIdentity | undefined {
    const identity = this.getWorkerIdentity(nodeId);
    if (!identity) return undefined;
    const revoked = { ...identity, revokedAt: now.toISOString() };
    this.saveWorkerIdentity(revoked, now);
    return revoked;
  }

  close(): void {
    this.db.close();
  }
}
