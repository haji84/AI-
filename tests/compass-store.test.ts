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

test("partial state update preserves unrelated fields", () => {
  withStore((store) => {
    store.updateState({
      phase: "Phase X",
      status: "READY",
      completed: ["A"],
      blockers: ["B"],
      nextAction: "C",
    });
    const after = store.updateState({ status: "RUNNING" });
    assert.equal(after.phase, "Phase X");
    assert.equal(after.status, "RUNNING");
    assert.deepEqual(after.completed, ["A"]);
    assert.deepEqual(after.blockers, ["B"]);
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
      verification: {
        status: "PASS",
        summary: "Persistence tests passed",
        evidence: ["node --test"],
      },
      nextAction: "Implement MCP server",
    });

    assert.equal(result.state.status, "completed");
    assert.deepEqual(result.state.completed, ["persistence"]);
    assert.equal(result.state.nextAction, "Implement MCP server");
    assert.equal(result.verification?.status, "PASS");
    assert.equal(store.getHistory(1)[0]?.summary, "Implemented persistence");
  });
});

test("write-back rollback leaves no partial history or verification", () => {
  const dir = mkdtempSync(join(tmpdir(), "compass-rollback-"));
  const dbPath = join(dir, "compass.db");
  const store = new CompassStore(dbPath);
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
          verification: { status: "PASS", summary: "Should roll back too" },
          nextAction: "Never persisted",
        }),
      /forced state failure/,
    );
    assert.deepEqual(store.getHistory(10), []);
    assert.equal(store.getState().nextAction, null);

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
