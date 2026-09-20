import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SharedContextRecord, SharedContextStatus, SharedContextStore } from "./shared-context.ts";

interface Row { payload: string }

export class SqliteSharedContextStore implements SharedContextStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS shared_context (
        id TEXT PRIMARY KEY,
        goal_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS shared_context_goal_status
        ON shared_context(goal_id, status, created_at DESC);
    `);
  }

  async put(record: SharedContextRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO shared_context (id, goal_id, status, created_at, payload)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        goal_id = excluded.goal_id,
        status = excluded.status,
        payload = excluded.payload
    `).run(record.id, record.goalId ?? null, record.status, record.createdAt, JSON.stringify(record));
  }

  async list(input: { goalId?: string; status?: SharedContextStatus; limit?: number } = {}): Promise<SharedContextRecord[]> {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    let rows: Row[];
    if (input.goalId && input.status) {
      rows = this.db.prepare(
        "SELECT payload FROM shared_context WHERE goal_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
      ).all(input.goalId, input.status, limit) as unknown as Row[];
    } else if (input.goalId) {
      rows = this.db.prepare(
        "SELECT payload FROM shared_context WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?",
      ).all(input.goalId, limit) as unknown as Row[];
    } else if (input.status) {
      rows = this.db.prepare(
        "SELECT payload FROM shared_context WHERE status = ? ORDER BY created_at DESC LIMIT ?",
      ).all(input.status, limit) as unknown as Row[];
    } else {
      rows = this.db.prepare(
        "SELECT payload FROM shared_context ORDER BY created_at DESC LIMIT ?",
      ).all(limit) as unknown as Row[];
    }
    return rows.map((row) => JSON.parse(row.payload) as SharedContextRecord);
  }

  close(): void { this.db.close(); }
}
