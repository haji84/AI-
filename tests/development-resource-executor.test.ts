import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalRegistryAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { nextResourceWait } from "../src/orchestrator/development-resource-wait.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";

test("real Goal executor persists HTTP pressure through WorkRun and DevelopmentJob; due/deadline gates prevent repeated requests", { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-resource-executor-"));
  const path = join(root, "compass.sqlite");
  let calls = 0;
  const endpoint = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, capabilities: ["code-builder", "filesystem"], engine: "test-fixture", inference: { locality: "device", networkAccess: false } })); return;
    }
    calls++;
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, blocker: "WAITING_FOR_RESOURCE", summary: "bounded wait", evidence: { resourceWait: { status: "WAITING_FOR_RESOURCE", reason: "commit pressure", retryAfterMs: 30_000, observedAt: new Date().toISOString() } } }));
  });
  endpoint.listen(0, "127.0.0.1"); await once(endpoint, "listening");
  const db = new CompassStore(path);
  try {
    const active = await new CompassGoalRegistryAdapter(db).create({ title: "Implement local test fixture", description: "Build a local fixture", successCriteria: ["verified"], constraints: [] });
    const runs = new CompassWorkRunStore(db);
    await runs.put(createQueuedWorkRun(active.goalId));
    const invoke = () => promisify(execFile)(process.execPath, ["scripts/jarvis-goal-executor.ts"], { timeout: 5000, windowsHide: true, maxBuffer: 16_384, env: { ...process.env, GITHUB_TOKEN: "", CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:" + (endpoint.address() as { port: number }).port, CODE_BUILDER_LOCAL_TOKEN: "resource-fixture-token", JARVIS_GOAL_EXECUTION_GOAL_ID: active.goalId, JARVIS_GOAL_EXECUTION_COMPASS_PATH: path, JARVIS_GOAL_EXECUTION_CONTEXT_B64: "", GORIQ_SELF_DEVELOPMENT_RUNTIME: "1", GORIQ_SELF_DEVELOPMENT_RELEASE_URL: "", GORIQ_SELF_DEVELOPMENT_RELEASE_TOKEN: "", GORIQ_SELF_DEVELOPMENT_TASK_AUTHORIZATION_JSON: "", GORIQ_SELF_DEVELOPMENT_TARGET_FILES: "tests/fixtures/autonomous-builder-e2e.txt" } });
    await invoke();
    const waiting = await runs.getByGoal(active.goalId);
    assert.equal(waiting?.phase, "RUNNING"); assert.equal(waiting?.resourceWait?.checks, 1);
    const job = (await new JsonFileDevelopmentJobStore(join(root, "self-development", "jobs.json")).getByGoal(active.goalId))[0]!;
    assert.equal(job.phase, "WAITING_FOR_RESOURCE"); assert.equal(job.attempts.length, 0);
    assert.equal(calls, 1);
    await invoke(); assert.equal(calls, 1, "persisted due time applies across processes");
    const expired = nextResourceWait(undefined, { status: "WAITING_FOR_RESOURCE", reason: "commit pressure", retryAfterMs: 30_000, observedAt: new Date().toISOString() }, new Date(Date.now() - 31 * 60_000));
    await runs.put({ ...waiting!, resourceWait: expired });
    await invoke();
    assert.equal((await runs.getByGoal(active.goalId))?.phase, "BLOCKED");
    assert.ok((await runs.getByGoal(active.goalId))?.blockers.includes("resource_wait_budget_exhausted"));
    assert.equal(calls, 1, "expired budget blocks before Builder/brain execution");
  } finally {
    db.close(); await new Promise<void>(done => endpoint.close(() => done()));
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  }
});
