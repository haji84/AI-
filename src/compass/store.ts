import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type VerificationStatus = "PASS" | "FAIL";

export interface GoalRecord {
  id: number;
  title: string;
  description: string;
  successCriteria: unknown[];
  constraints: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface StateRecord {
  projectId: string;
  phase: string | null;
  status: string | null;
  completed: unknown[];
  active: unknown[];
  blockers: unknown[];
  verificationSummary: string | null;
  nextAction: string | null;
  updatedAt: string;
}

export interface VerificationRecord {
  id: number;
  status: VerificationStatus;
  summary: string;
  evidence: unknown | null;
  createdAt: string;
}

export interface HistoryRecord {
  id: number;
  taskStatus: string;
  summary: string;
  completed: unknown[];
  blockers: unknown[];
  verificationId: number | null;
  nextAction: string | null;
  createdAt: string;
}

export interface StatePatch {
  phase?: string | null;
  status?: string | null;
  completed?: unknown[];
  active?: unknown[];
  blockers?: unknown[];
  verificationSummary?: string | null;
  nextAction?: string | null;
}

export interface WriteBackInput {
  status: string;
  summary: string;
  completed?: unknown[];
  blockers?: unknown[];
  active?: unknown[];
  phase?: string | null;
  verification?: {
    status: VerificationStatus;
    summary: string;
    evidence?: unknown;
  };
  nextAction?: string | null;
}

const PROJECT_ID = "default";

function nowIso(): string {
  return new Date().toISOString();
}

function encode(value: unknown): string {
  return JSON.stringify(value);
}

function decodeArray(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Stored Compass value is not an array");
  return parsed;
}

function decodeUnknown(value: unknown): unknown | null {
  if (value === null || typeof value !== "string") return null;
  return JSON.parse(value);
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} must not be empty`);
}

function assertVerificationStatus(status: string): asserts status is VerificationStatus {
  if (status !== "PASS" && status !== "FAIL") {
    throw new Error("verification status must be PASS or FAIL");
  }
}

export class CompassStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goal (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        success_criteria TEXT NOT NULL,
        constraints TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS state (
        project_id TEXT PRIMARY KEY,
        phase TEXT,
        status TEXT,
        completed TEXT NOT NULL,
        active TEXT NOT NULL,
        blockers TEXT NOT NULL,
        verification_summary TEXT,
        next_action TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verification (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
        summary TEXT NOT NULL,
        evidence TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_status TEXT NOT NULL,
        summary TEXT NOT NULL,
        completed TEXT NOT NULL,
        blockers TEXT NOT NULL,
        verification_id INTEGER,
        next_action TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (verification_id) REFERENCES verification(id)
      );
    `);

    const timestamp = nowIso();
    this.db.prepare(`
      INSERT OR IGNORE INTO state (
        project_id, phase, status, completed, active, blockers,
        verification_summary, next_action, updated_at
      ) VALUES (?, NULL, NULL, '[]', '[]', '[]', NULL, NULL, ?)
    `).run(PROJECT_ID, timestamp);
  }

  getGoal(): GoalRecord | null {
    const row = this.db.prepare("SELECT * FROM goal WHERE id = 1").get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      title: String(row.title),
      description: String(row.description),
      successCriteria: decodeArray(row.success_criteria),
      constraints: decodeArray(row.constraints),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  setGoal(input: {
    title: string;
    description?: string;
    successCriteria?: unknown[];
    constraints?: unknown[];
  }): GoalRecord {
    assertNonEmpty(input.title, "title");
    const timestamp = nowIso();
    const existing = this.getGoal();
    const createdAt = existing?.createdAt ?? timestamp;
    this.db.prepare(`
      INSERT INTO goal (id, title, description, success_criteria, constraints, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        success_criteria = excluded.success_criteria,
        constraints = excluded.constraints,
        updated_at = excluded.updated_at
    `).run(
      input.title,
      input.description ?? "",
      encode(input.successCriteria ?? []),
      encode(input.constraints ?? []),
      createdAt,
      timestamp,
    );
    return this.getGoal() as GoalRecord;
  }

  getState(): StateRecord {
    const row = this.db.prepare("SELECT * FROM state WHERE project_id = ?").get(PROJECT_ID) as Record<string, unknown>;
    return {
      projectId: String(row.project_id),
      phase: row.phase === null ? null : String(row.phase),
      status: row.status === null ? null : String(row.status),
      completed: decodeArray(row.completed),
      active: decodeArray(row.active),
      blockers: decodeArray(row.blockers),
      verificationSummary: row.verification_summary === null ? null : String(row.verification_summary),
      nextAction: row.next_action === null ? null : String(row.next_action),
      updatedAt: String(row.updated_at),
    };
  }

  updateState(patch: StatePatch): StateRecord {
    const current = this.getState();
    const next = {
      phase: patch.phase === undefined ? current.phase : patch.phase,
      status: patch.status === undefined ? current.status : patch.status,
      completed: patch.completed === undefined ? current.completed : patch.completed,
      active: patch.active === undefined ? current.active : patch.active,
      blockers: patch.blockers === undefined ? current.blockers : patch.blockers,
      verificationSummary:
        patch.verificationSummary === undefined ? current.verificationSummary : patch.verificationSummary,
      nextAction: patch.nextAction === undefined ? current.nextAction : patch.nextAction,
    };
    this.db.prepare(`
      UPDATE state SET
        phase = ?, status = ?, completed = ?, active = ?, blockers = ?,
        verification_summary = ?, next_action = ?, updated_at = ?
      WHERE project_id = ?
    `).run(
      next.phase,
      next.status,
      encode(next.completed),
      encode(next.active),
      encode(next.blockers),
      next.verificationSummary,
      next.nextAction,
      nowIso(),
      PROJECT_ID,
    );
    return this.getState();
  }

  getNextAction(): string | null {
    return this.getState().nextAction;
  }

  setNextAction(nextAction: string | null): StateRecord {
    return this.updateState({ nextAction });
  }

  recordVerification(input: {
    status: VerificationStatus;
    summary: string;
    evidence?: unknown;
  }): VerificationRecord {
    assertVerificationStatus(input.status);
    assertNonEmpty(input.summary, "verification summary");
    const timestamp = nowIso();
    const result = this.db.prepare(`
      INSERT INTO verification (status, summary, evidence, created_at)
      VALUES (?, ?, ?, ?)
    `).run(input.status, input.summary, input.evidence === undefined ? null : encode(input.evidence), timestamp);
    return this.getVerification(Number(result.lastInsertRowid));
  }

  private getVerification(id: number): VerificationRecord {
    const row = this.db.prepare("SELECT * FROM verification WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`verification ${id} not found`);
    return {
      id: Number(row.id),
      status: String(row.status) as VerificationStatus,
      summary: String(row.summary),
      evidence: decodeUnknown(row.evidence),
      createdAt: String(row.created_at),
    };
  }

  getHistory(limit = 20): HistoryRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("history limit must be an integer from 1 to 100");
    }
    const rows = this.db.prepare("SELECT * FROM history ORDER BY id DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id),
      taskStatus: String(row.task_status),
      summary: String(row.summary),
      completed: decodeArray(row.completed),
      blockers: decodeArray(row.blockers),
      verificationId: row.verification_id === null ? null : Number(row.verification_id),
      nextAction: row.next_action === null ? null : String(row.next_action),
      createdAt: String(row.created_at),
    }));
  }

  writeBack(input: WriteBackInput): {
    state: StateRecord;
    history: HistoryRecord;
    verification: VerificationRecord | null;
  } {
    assertNonEmpty(input.status, "status");
    assertNonEmpty(input.summary, "summary");
    if (input.verification) {
      assertVerificationStatus(input.verification.status);
      assertNonEmpty(input.verification.summary, "verification summary");
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      let verification: VerificationRecord | null = null;
      let verificationId: number | null = null;
      if (input.verification) {
        verification = this.recordVerification(input.verification);
        verificationId = verification.id;
      }

      const current = this.getState();
      const nextCompleted = input.completed ?? current.completed;
      const nextBlockers = input.blockers ?? current.blockers;
      const nextActive = input.active ?? current.active;
      const nextAction = input.nextAction === undefined ? current.nextAction : input.nextAction;
      const timestamp = nowIso();

      const historyResult = this.db.prepare(`
        INSERT INTO history (
          task_status, summary, completed, blockers, verification_id, next_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.status,
        input.summary,
        encode(nextCompleted),
        encode(nextBlockers),
        verificationId,
        nextAction,
        timestamp,
      );

      this.db.prepare(`
        UPDATE state SET
          phase = ?, status = ?, completed = ?, active = ?, blockers = ?,
          verification_summary = ?, next_action = ?, updated_at = ?
        WHERE project_id = ?
      `).run(
        input.phase === undefined ? current.phase : input.phase,
        input.status,
        encode(nextCompleted),
        encode(nextActive),
        encode(nextBlockers),
        verification?.summary ?? current.verificationSummary,
        nextAction,
        timestamp,
        PROJECT_ID,
      );

      this.db.exec("COMMIT");
      const historyId = Number(historyResult.lastInsertRowid);
      const history = this.getHistory(100).find((entry) => entry.id === historyId);
      if (!history) throw new Error("write-back history record missing after commit");
      return { state: this.getState(), history, verification };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
