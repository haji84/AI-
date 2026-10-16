import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const goal = { title: "Inspect local status", description: "Inspect only", successCriteria: ["status independently known"], constraints: ["read only"] };

test("scheduled development verifies Builder output instead of accepting its success claim", async () => {
  const f = fixture();
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.url === "/health"
      ? { ok: true, capabilities: ["code-builder"], engine: "llama.cpp", inference: { locality: "device", networkAccess: false } }
      : request.url === "/verify" ? { ok: false, summary: "Independent readback failed", evidence: { expected: "42", actual: "wrong" } }
      : { ok: true, summary: "Builder claims success" }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    f.compass.setGoal({ title: "Implement tests/fixtures/result.txt", successCriteria: ["implement output"] });
    f.compass.updateState({ status: "continue", nextAction: "Implement tests/fixtures/result.txt", blockers: [] });
    const child = spawn(process.execPath, [resolve("scripts/autonomy-run.ts"), "--max-cycles=1"], {
      env: { ...process.env, COMPASS_DB_PATH: join(f.dir, "compass.db"), AUTONOMY_CHECKPOINT_PATH: f.checkpointPath,
        CODE_BUILDER_LOCAL_URL: `http://127.0.0.1:${address.port}`, CODE_BUILDER_LOCAL_TOKEN: "fixture-only-token",
        CODE_BUILDER_ENDPOINTS_JSON: "{}" }, stdio: ["ignore", "pipe", "pipe"], timeout: 15_000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    assert.equal(code, 0, stderr);
    assert.ok(requests.includes("/build"));
    assert.ok(requests.includes("/verify"), "Builder success must reach the independent verification endpoint");
    assert.equal(JSON.parse(stdout).report.cycles[0].verification.ok, false);
    assert.deepEqual(f.compass.getState().completed, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.compass.close(); rmSync(f.dir, { recursive: true, force: true });
  }
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "goriq-resume-"));
  const dbPath = join(dir, "compass.db");
  const checkpointPath = join(dir, "autonomy-checkpoint.json");
  const compass = new CompassStore(dbPath);
  compass.setGoal(goal);
  compass.updateState({ status: "continue", nextAction: "Inspect remaining evidence", blockers: [] });
  const checkpoint = { version: 2, goalFingerprint: hash(compass.getGoal()), stateFingerprint: hash(compass.getState()), requiresResume: true, nextAction: compass.getNextAction() };
  writeFileSync(checkpointPath, JSON.stringify(checkpoint));
  const run = (scheduled = false) => spawnSync(process.execPath, scheduled
    ? [resolve("scripts/autonomy-event-run.ts"), "--type=schedule"]
    : [resolve("scripts/autonomy-run.ts"), "--resume-only"], {
    env: { ...process.env, COMPASS_DB_PATH: dbPath, AUTONOMY_CHECKPOINT_PATH: checkpointPath },
    encoding: "utf8", timeout: 15000,
  });
  return { dir, compass, checkpointPath, checkpoint, run };
}

test("scheduled re-entry runs an exact persisted continuation without a new owner command", () => {
  const f = fixture();
  try {
    const result = f.run(true);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.ok(output.report, "the exact persisted hint must reach the bounded runner");
    assert.equal(output.report.cycles.length, 1);
    assert.equal(output.report.cycles[0].action.capability, "context.inspect");
    assert.equal(f.compass.getHistory().length, 1);
    const saved = JSON.parse(readFileSync(f.checkpointPath, "utf8"));
    assert.equal(saved.version, 2);
    assert.equal(saved.requiresResume, false, "inspection without verified DoD progress must not loop indefinitely");
    assert.equal(f.run(true).status, 0);
    assert.equal(f.compass.getHistory().length, 1);
  } finally { f.compass.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("fenced dry-run never writes verification or progress into the authoritative Compass", () => {
  const f = fixture();
  try {
    const before = f.compass.getState();
    const hint = readFileSync(f.checkpointPath, "utf8");
    const result = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--dry-run", "--max-cycles=1"], {
      env: { ...process.env, COMPASS_DB_PATH: join(f.dir, "compass.db"), AUTONOMY_CHECKPOINT_PATH: f.checkpointPath, AUTONOMY_COMPASS_SQLITE_FENCE: "1" },
      encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.compass.getState(), before);
    assert.equal(f.compass.getHistory().length, 0);
    assert.equal(readFileSync(f.checkpointPath, "utf8"), hint);
  } finally { f.compass.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("dry-run evaluates the same exact persisted resume hint without changing its timestamps", () => {
  const f = fixture();
  try {
    const before = f.compass.getState();
    const result = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--dry-run", "--resume-only"], {
      env: { ...process.env, COMPASS_DB_PATH: join(f.dir, "compass.db"), AUTONOMY_CHECKPOINT_PATH: f.checkpointPath },
      encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).report?.cycles.length, 1);
    assert.deepEqual(f.compass.getState(), before);
  } finally { f.compass.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("dry-run recovery consults the authoritative pending effect instead of an empty memory copy", () => {
  const f = fixture();
  try {
    const leases = f.compass.executionLease();
    const claim = leases.claim(goalWorkStateId(goal), "interrupted-worker", 60000);
    leases.reserveEffect(claim, "external-action");
    const result = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--dry-run"], {
      env: { ...process.env, COMPASS_DB_PATH: join(f.dir, "compass.db"), AUTONOMY_CHECKPOINT_PATH: f.checkpointPath, AUTONOMY_COMPASS_SQLITE_FENCE: "1", AUTONOMY_RECOVERY_ACTION_ID: "external-action" },
      encoding: "utf8", timeout: 15000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RECONCILIATION_REQUIRED/);
    assert.equal(leases.effectStatus(claim.taskId, "external-action"), "PENDING");
    assert.equal(f.compass.getHistory().length, 0);
  } finally { f.compass.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("same title cannot reuse a checkpoint after Goal criteria, constraints or description change", () => {
  for (const patch of [{ description: "different scope" }, { successCriteria: ["different DoD"] }, { constraints: ["new safety limit"] }]) {
    const f = fixture();
    try {
      // Legacy hints must also fail closed; title equality is not Goal identity.
      writeFileSync(f.checkpointPath, JSON.stringify({ version: 1, goalTitle: goal.title, requiresResume: true, nextAction: f.compass.getNextAction() }));
      f.compass.setGoal({ ...goal, ...patch });
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(f.compass.getHistory().length, 0);
      assert.equal(JSON.parse(result.stdout).status, "resume_not_authorized_or_unavailable");
    } finally { f.compass.close(); rmSync(f.dir, { recursive: true, force: true }); }
  }
});

test("terminal states and blockers never become resume authority", () => {
  for (const status of ["PAUSED", "paused", "BLOCKED", "blocked", "ACHIEVED", "goal_complete", "approval_required", "retry_exhausted", "UNKNOWN"]) {
    const f = fixture();
    try {
      f.compass.updateState({ status });
      writeFileSync(f.checkpointPath, JSON.stringify({ ...f.checkpoint, stateFingerprint: hash(f.compass.getState()) }));
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(f.compass.getHistory().length, 0, status);
      assert.equal(f.compass.getState().status, status);
    } finally { f.compass.close(); rmSync(f.dir, { recursive: true, force: true }); }
  }
  const f = fixture();
  try {
    f.compass.updateState({ blockers: ["authority_missing"] });
    writeFileSync(f.checkpointPath, JSON.stringify({ ...f.checkpoint, stateFingerprint: hash(f.compass.getState()) }));
    assert.equal(f.run().status, 0);
    assert.equal(f.compass.getHistory().length, 0);
  } finally { f.compass.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("changed persisted state or malformed checkpoint leaves history untouched", () => {
  for (const scenario of ["changed-state", "corrupt", "empty-action"]) {
    const f = fixture();
    try {
      if (scenario === "changed-state") f.compass.updateState({ active: ["new authoritative job"] });
      if (scenario === "corrupt") writeFileSync(f.checkpointPath, "{");
      if (scenario === "empty-action") writeFileSync(f.checkpointPath, JSON.stringify({ ...f.checkpoint, nextAction: "" }));
      assert.equal(f.run().status, 0);
      assert.equal(f.compass.getHistory().length, 0);
    } finally { f.compass.close(); rmSync(f.dir, { recursive: true, force: true }); }
  }
});
