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

test("decisions and deliverables survive restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "compass-state-restart-"));
  const dbPath = join(dir, "compass.db");
  const first = new CompassStore(dbPath);
  first.updateState({
    decisions: ["Keep local-first routing"],
    deliverables: ["Compass persistence patch"],
  });
  first.close();

  const second = new CompassStore(dbPath);
  try {
    const state = second.getState();
    assert.deepEqual(state.decisions, ["Keep local-first routing"]);
    assert.deepEqual(state.deliverables, ["Compass persistence patch"]);
  } finally {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy schema migrates decisions and deliverables without losing existing data", () => {
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
      project_id, phase, status, completed, active, blockers,
      verification_summary, next_action, updated_at
    ) VALUES (
      'default', 'legacy', 'RUNNING', '["kept"]', '["active"]', '["blocker"]',
      'legacy verification', 'legacy next', '2026-09-16T00:00:00.000Z'
    );
    INSERT INTO history (
      task_status, summary, completed, blockers, verification_id, next_action, created_at
    ) VALUES (
      'RUNNING', 'legacy history', '["kept"]', '["blocker"]', NULL, 'legacy next',
      '2026-09-16T00:00:00.000Z'
    );
  `);
  legacy.close();

  const store = new CompassStore(dbPath);
  try {
    const state = store.getState();
    assert.equal(state.phase, "legacy");
    assert.deepEqual(state.completed, ["kept"]);
    assert.deepEqual(state.decisions, []);
    assert.deepEqual(state.deliverables, []);

    const history = store.getHistory(1)[0];
    assert.equal(history?.summary, "legacy history");
    assert.deepEqual(history?.decisions, []);
    assert.deepEqual(history?.deliverables, []);

    const migrated = store.updateState({
      decisions: ["migrated decision"],
      deliverables: ["migrated deliverable"],
    });
    assert.deepEqual(migrated.decisions, ["migrated decision"]);
    assert.deepEqual(migrated.deliverables, ["migrated deliverable"]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("partial state update preserves unrelated fields", () => {
  withStore((store) => {
    store.updateState({
      phase: "Phase X",
      status: "READY",
      completed: ["A"],
      blockers: ["B"],
      decisions: ["D"],
      deliverables: ["E"],
      nextAction: "C",
    });
    const after = store.updateState({ status: "RUNNING" });
    assert.equal(after.phase, "Phase X");
    assert.equal(after.status, "RUNNING");
    assert.deepEqual(after.completed, ["A"]);
    assert.deepEqual(after.blockers, ["B"]);
    assert.deepEqual(after.decisions, ["D"]);
    assert.deepEqual(after.deliverables, ["E"]);
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
      decisions: ["Store caller-supplied decisions only"],
      deliverables: ["migration", "tests"],
      verification: {
        status: "PASS",
        summary: "Persistence tests passed",
        evidence: ["node --test"],
      },
      nextAction: "Implement MCP server",
    });

    assert.equal(result.state.status, "completed");
    assert.deepEqual(result.state.completed, ["persistence"]);
    assert.deepEqual(result.state.decisions, ["Store caller-supplied decisions only"]);
    assert.deepEqual(result.state.deliverables, ["migration", "tests"]);
    assert.equal(result.state.nextAction, "Implement MCP server");
    assert.equal(result.verification?.status, "PASS");
    assert.deepEqual(result.history.decisions, ["Store caller-supplied decisions only"]);
    assert.deepEqual(result.history.deliverables, ["migration", "tests"]);
    assert.equal(store.getHistory(1)[0]?.summary, "Implemented persistence");
  });
});

test("write-back preserves decisions and deliverables when omitted", () => {
  withStore((store) => {
    store.updateState({ decisions: ["keep decision"], deliverables: ["keep deliverable"] });
    const result = store.writeBack({ status: "RUNNING", summary: "No metadata replacement" });
    assert.deepEqual(result.state.decisions, ["keep decision"]);
    assert.deepEqual(result.state.deliverables, ["keep deliverable"]);
    assert.deepEqual(result.history.decisions, ["keep decision"]);
    assert.deepEqual(result.history.deliverables, ["keep deliverable"]);
  });
});

test("write-back rollback leaves no partial history or verification", () => {
  const dir = mkdtempSync(join(tmpdir(), "compass-rollback-"));
  const dbPath = join(dir, "compass.db");
  const store = new CompassStore(dbPath);
  store.updateState({ decisions: ["keep decision"], deliverables: ["keep deliverable"] });
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
          decisions: ["must not persist"],
          deliverables: ["must not persist"],
          verification: { status: "PASS", summary: "Should roll back too" },
          nextAction: "Never persisted",
        }),
      /forced state failure/,
    );
    assert.deepEqual(store.getHistory(10), []);
    assert.equal(store.getState().nextAction, null);
    assert.deepEqual(store.getState().decisions, ["keep decision"]);
    assert.deepEqual(store.getState().deliverables, ["keep deliverable"]);

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
