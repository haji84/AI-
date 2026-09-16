import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CompassStore } from "../src/compass/store.ts";

function withStore(run: (store: CompassStore, dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "compass-store-"));
  const dbPath = join(dir, "compass.db");
  const store = new CompassStore(dbPath);
  try {
    run(store, dbPath);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("first run initializes state", () => {
  withStore((store) => {
    const state = store.getState();
    assert.equal(state.projectId, "default");
    assert.deepEqual(state.completed, []);
    assert.deepEqual(state.blockers, []);
    assert.deepEqual(state.decisions, []);
    assert.deepEqual(state.deliverables, []);
  });
});

test("set/get goal round trip survives restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "compass-restart-"));
  const dbPath = join(dir, "compass.db");
  const first = new CompassStore(dbPath);
  first.setGoal({
    title: "Ship Compass v1",
    description: "Persistent handoff",
    successCriteria: ["stdio works"],
    constraints: ["local only"],
  });
  first.close();

  const second = new CompassStore(dbPath);
  try {
    const goal = second.getGoal();
    assert.equal(goal?.title, "Ship Compass v1");
    assert.deepEqual(goal?.successCriteria, ["stdio works"]);
    assert.deepEqual(goal?.constraints, ["local only"]);
  } finally {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("partial state update preserves unrelated fields including decisions and deliverables", () => {
  withStore((store) => {
    store.updateState({
      phase: "Phase X",
      status: "READY",
      completed: ["A"],
      blockers: ["B"],
      decisions: [{ id: "D1", text: "Use local storage" }],
      deliverables: [{ id: "artifact-1", path: "report.json" }],
      nextAction: "C",
    });
    const after = store.updateState({ status: "RUNNING" });
    assert.equal(after.phase, "Phase X");
    assert.equal(after.status, "RUNNING");
    assert.deepEqual(after.completed, ["A"]);
    assert.deepEqual(after.blockers, ["B"]);
    assert.deepEqual(after.decisions, [{ id: "D1", text: "Use local storage" }]);
    assert.deepEqual(after.deliverables, [{ id: "artifact-1", path: "report.json" }]);
    assert.equal(after.nextAction, "C");
  });
});

test("set/get/clear next action", () => {
  withStore((store) => {
    store.setNextAction("Implement transport");
    assert.equal(store.getNextAction(), "Implement transport");
    store.setNextAction(null);
    assert.equal(store.getNextAction(), null);
  });
});

test("verification PASS persists and invalid status is rejected", () => {
  withStore((store) => {
    const record = store.recordVerification({
      status: "PASS",
      summary: "Tests passed",
      evidence: ["pnpm test"],
    });
    assert.equal(record.status, "PASS");
    assert.deepEqual(record.evidence, ["pnpm test"]);
    assert.throws(
      () => store.recordVerification({ status: "MAYBE" as "PASS", summary: "bad" }),
      /PASS or FAIL/,
    );
  });
});

test("write-back creates history and updates state atomically on success", () => {
  withStore((store) => {
    const result = store.writeBack({
      status: "completed",
      summary: "Implemented persistence",
      completed: ["persistence"],
      blockers: [],
      decisions: ["SQLite is the durable source"],
      deliverables: ["compass.db"],
      verification: {
        status: "PASS",
        summary: "Persistence tests passed",
        evidence: ["node --test"],
      },
      nextAction: "Implement MCP server",
    });

    assert.equal(result.state.status, "completed");
    assert.deepEqual(result.state.completed, ["persistence"]);
    assert.deepEqual(result.state.decisions, ["SQLite is the durable source"]);
    assert.deepEqual(result.state.deliverables, ["compass.db"]);
    assert.equal(result.state.nextAction, "Implement MCP server");
    assert.equal(result.verification?.status, "PASS");
    const history = store.getHistory(1)[0];
    assert.equal(history?.summary, "Implemented persistence");
    assert.deepEqual(history?.decisions, ["SQLite is the durable source"]);
    assert.deepEqual(history?.deliverables, ["compass.db"]);
  });
});

test("write-back preserves decisions and deliverables when omitted", () => {
  withStore((store) => {
    store.updateState({ decisions: ["keep-decision"], deliverables: ["keep-deliverable"] });
    const result = store.writeBack({ status: "running", summary: "No replacement supplied" });
    assert.deepEqual(result.state.decisions, ["keep-decision"]);
    assert.deepEqual(result.state.deliverables, ["keep-deliverable"]);
    assert.deepEqual(result.history.decisions, ["keep-decision"]);
    assert.deepEqual(result.history.deliverables, ["keep-deliverable"]);
  });
});

test("write-back rollback leaves no partial history or verification", () => {
  const dir = mkdtempSync(join(tmpdir(), "compass-rollback-"));
  const dbPath = join(dir, "compass.db");
  const store = new CompassStore(dbPath);
  store.updateState({ decisions: ["before"], deliverables: ["artifact-before"] });
  const external = new DatabaseSync(dbPath);
  external.exec(`
    CREATE TRIGGER force_state_failure
    BEFORE UPDATE ON state
    BEGIN
      SELECT RAISE(FAIL, 'forced state failure');
    END;
  `);
  external.close();

  try {
    assert.throws(
      () =>
        store.writeBack({
          status: "completed",
          summary: "Must roll back",
          decisions: ["must-not-persist"],
          deliverables: ["must-not-persist"],
          verification: { status: "PASS", summary: "Should roll back too" },
          nextAction: "Never persisted",
        }),
      /forced state failure/,
    );
    assert.deepEqual(store.getHistory(10), []);
    const state = store.getState();
    assert.equal(state.nextAction, null);
    assert.deepEqual(state.decisions, ["before"]);
    assert.deepEqual(state.deliverables, ["artifact-before"]);

    const verifyDb = new DatabaseSync(dbPath);
    try {
      const count = verifyDb.prepare("SELECT COUNT(*) AS count FROM verification").get() as { count: number };
      assert.equal(count.count, 0);
    } finally {
      verifyDb.close();
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy state/history schema migrates decisions and deliverables without losing existing data", () => {
  const dir = mkdtempSync(join(tmpdir(), "compass-legacy-"));
  const dbPath = join(dir, "compass.db");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE state (
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
    CREATE TABLE history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_status TEXT NOT NULL,
      summary TEXT NOT NULL,
      completed TEXT NOT NULL,
      blockers TEXT NOT NULL,
      verification_id INTEGER,
      next_action TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO state (
      project_id, phase, status, completed, active, blockers, verification_summary, next_action, updated_at
    ) VALUES ('default', 'legacy', 'running', '["old-complete"]', '[]', '[]', NULL, 'old-next', '2026-09-16T00:00:00.000Z');
    INSERT INTO history (
      task_status, summary, completed, blockers, verification_id, next_action, created_at
    ) VALUES ('running', 'legacy history', '["old-complete"]', '[]', NULL, 'old-next', '2026-09-16T00:00:00.000Z');
  `);
  legacy.close();

  const migrated = new CompassStore(dbPath);
  try {
    const state = migrated.getState();
    assert.equal(state.phase, "legacy");
    assert.deepEqual(state.completed, ["old-complete"]);
    assert.equal(state.nextAction, "old-next");
    assert.deepEqual(state.decisions, []);
    assert.deepEqual(state.deliverables, []);
    const history = migrated.getHistory(1)[0];
    assert.equal(history?.summary, "legacy history");
    assert.deepEqual(history?.decisions, []);
    assert.deepEqual(history?.deliverables, []);

    migrated.updateState({ decisions: ["new decision"], deliverables: ["new artifact"] });
    assert.deepEqual(migrated.getState().decisions, ["new decision"]);
    assert.deepEqual(migrated.getState().deliverables, ["new artifact"]);
  } finally {
    migrated.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("history is newest first and respects limit", () => {
  withStore((store) => {
    store.writeBack({ status: "completed", summary: "first" });
    store.writeBack({ status: "completed", summary: "second" });
    store.writeBack({ status: "completed", summary: "third" });
    const history = store.getHistory(2);
    assert.deepEqual(history.map((entry) => entry.summary), ["third", "second"]);
    assert.throws(() => store.getHistory(0), /1 to 100/);
    assert.throws(() => store.getHistory(101), /1 to 100/);
  });
});
