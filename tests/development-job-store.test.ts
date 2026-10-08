import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDevelopmentJob } from "../src/orchestrator/development-job.ts";
import {
  JsonFileDevelopmentJobStore,
  MemoryDevelopmentJobStore,
} from "../src/orchestrator/development-job-store.ts";

function job() {
  return createDevelopmentJob({
    jobId: "job-store-1",
    goalId: "goal-681",
    requirementIds: ["CORE-014"],
    acceptanceCriteria: ["durable"],
    definitionOfDone: [{ id: "durable", description: "survives restart", required: true }],
    baseRevision: "b".repeat(40),
    approvalScope: { taskScopeId: "issue-681", maxRisk: "low" },
    workItems: [{ id: "persist", objective: "persist", dependsOn: [], requiredCapabilities: ["filesystem"] }],
  }, new Date("2026-09-26T00:00:00.000Z"));
}

test("memory store returns clones and deduplicates job identity", async () => {
  const store = new MemoryDevelopmentJobStore();
  const value = job();
  await store.put(value);
  const restored = await store.get(value.jobId);
  assert.deepEqual(restored, value);
  restored!.blockers.push("mutated outside store");
  assert.deepEqual((await store.get(value.jobId))?.blockers, []);
  await assert.rejects(() => store.put({ ...value, goalId: "other-goal" }), /identity conflict/i);
});
test("JSON store survives reconstruction and uses a versioned snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goriq-development-job-"));
  const path = join(directory, "jobs.json");
  try {
    const first = new JsonFileDevelopmentJobStore(path);
    await first.put(job());
    const second = new JsonFileDevelopmentJobStore(path);
    assert.deepEqual(await second.get("job-store-1"), job());
    const raw = JSON.parse(await readFile(path, "utf8")) as { version: number; jobs: unknown[] };
    assert.equal(raw.version, 1);
    assert.equal(raw.jobs.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON store rejects a corrupt or unsupported snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goriq-development-job-corrupt-"));
  const path = join(directory, "jobs.json");
  try {
    await writeFile(path, JSON.stringify({ version: 99, jobs: [] }), "utf8");
    const store = new JsonFileDevelopmentJobStore(path);
    await assert.rejects(() => store.list(), /unsupported development job snapshot/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
