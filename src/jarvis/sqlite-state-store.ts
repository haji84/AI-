import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { JarvisControlPlaneSnapshot } from "./control-plane.ts";

interface SnapshotRow {
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
    `);
  }

  save(snapshot: JarvisControlPlaneSnapshot): void {
    const statement = this.db.prepare(`
      INSERT INTO jarvis_state (id, payload, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `);
    statement.run(JSON.stringify(snapshot), snapshot.generatedAt);
  }

  load(): JarvisControlPlaneSnapshot | undefined {
    const row = this.db.prepare("SELECT payload FROM jarvis_state WHERE id = 1").get() as SnapshotRow | undefined;
    if (!row) return undefined;
    return JSON.parse(row.payload) as JarvisControlPlaneSnapshot;
  }

  close(): void {
    this.db.close();
  }
}
