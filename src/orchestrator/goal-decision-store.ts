import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GoalControllerDecision, GoalDecisionStore } from "./goal-controller-runtime.ts";

interface DecisionRow { payload: string }

export class SqliteGoalDecisionStore implements GoalDecisionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS goal_intake_decision (
        idempotency_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  async get(idempotencyKey: string): Promise<GoalControllerDecision | null> {
    const row = this.db.prepare(
      "SELECT payload FROM goal_intake_decision WHERE idempotency_key = ?",
    ).get(idempotencyKey) as DecisionRow | undefined;
    return row ? JSON.parse(row.payload) as GoalControllerDecision : null;
  }

  async put(idempotencyKey: string, decision: GoalControllerDecision): Promise<void> {
    this.db.prepare(`
      INSERT INTO goal_intake_decision (idempotency_key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(idempotencyKey, JSON.stringify(decision), new Date().toISOString());
  }

  close(): void { this.db.close(); }
}
