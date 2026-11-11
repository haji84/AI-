import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { acquireCognitiveLease } from "../src/gai/cognitive-lease.ts";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { createDevelopmentJob, DevelopmentJobStateController } from "../src/orchestrator/development-job.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { ResidentDevelopmentGoalHost, type ResidentDevelopmentStages } from "../src/orchestrator/resident-development-goal-host.ts";
import { acquireResidentExecutionWriter, ResidentExecutionBusyError } from "../src/orchestrator/resident-development-admission.ts";
import { createRuntimeResidentAdmission } from "../src/orchestrator/runtime-resident-admission.ts";
import { residentDevelopmentGoalDigest } from "../src/orchestrator/resident-development-sequence.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";
import { nextResourceWait } from "../src/orchestrator/development-resource-wait.ts";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const base = "a".repeat(40), contract = "e".repeat(64);
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "goriq-host-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = join(root, "runtime"); mkdirSync(runtimeRoot);
  const compassPath = join(root, "compass.db"), compass = new CompassStore(compassPath);
  compass.setGoal({ title: "Implement bounded existing GORIQ code", description: "Repair bounded existing code", successCriteria: ["usable independently verified artifact"], constraints: [] });
  const goal = compassGoalToLoopGoal(compass.getGoal()!);
  compass.close();
  const goalId = goalWorkStateId(goal), jobs = new JsonFileDevelopmentJobStore(join(root, "jobs.json"));
  const changes = new JsonFileDevelopmentChangeSetStore(join(root, "changes.json"));
  const config = { version: 1, authorityPath: compassPath, goalId, goalDigest: residentDevelopmentGoalDigest(goal),
    taskScopeId: "issue:1219", executionContractDigest: contract, expiresAt: new Date(Date.now() + 600_000).toISOString(),
    hostId: "github-hosted", privacy: "public", nodes: [
      { id: "github-hosted", kind: "cloud", capabilities: ["code-builder", "filesystem"], online: true, healthy: true,
        privacy: "public-ok", incrementalCost: 0, reliability: 1, latencyMs: 1, evidenceModes: ["LOCAL"] },
      { id: "owner-device", kind: "device", capabilities: ["device-specific"], online: false, healthy: false,
        privacy: "local-only", incrementalCost: 0, reliability: 1, latencyMs: 1, evidenceModes: ["DEVICE"] },
    ] };
  const file = join(root, "host.json");
  const env: Record<string, string | undefined> = { GORIQ_EXECUTION_HOST_MODE: "hosted", GORIQ_EXECUTION_HOST_ID: "github-hosted",
    GORIQ_HOSTED_ROUTING_FILE: file, GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256: contract };
  const save = () => { const raw = JSON.stringify(config); writeFileSync(file, raw); env.GORIQ_HOSTED_ROUTING_SHA256 = hash(raw); };
  save();
  const builds: string[] = [], checks: string[] = [];
  const stages: ResidentDevelopmentStages = { deferMissingVerification: true,
    async build({ job, workItemId, beforeWrite }) {
      await beforeWrite?.(); builds.push(job.jobId);
      return createDevelopmentChangeSet({ changeSetId: job.jobId + ":candidate", jobId: job.jobId, workItemId,
        deviceId: "fixture-builder", baseRevision: base, changedPaths: ["src/feature.ts"], affectedSymbols: [],
        patchDigest: "b".repeat(64), artifactDigest: "b".repeat(64), candidateRevision: "c".repeat(40),
        evidenceDigest: "d".repeat(64), rollback: { kind: "git-base", reference: base } });
    },
    async verify({ job }) { checks.push(job.jobId); return []; },
    async releaseState() { throw Error("missing verifier cannot release"); },
  };
  const create = async (capabilities = ["code-builder"], risk: "low" | "medium" | "high" = "low") => {
    await jobs.put(createDevelopmentJob({ jobId: "existing-job", goalId, requirementIds: ["CORE-014"],
      acceptanceCriteria: goal.successCriteria, definitionOfDone: [{ id: "criterion-1", description: goal.successCriteria[0]!, required: true }],
      baseRevision: base, approvalScope: { taskScopeId: "issue:1219", maxRisk: risk },
      workItems: [{ id: "existing-job:implement", objective: goal.title, requiredCapabilities: capabilities, dependsOn: [] }] }));
  };
  const host = () => new ResidentDevelopmentGoalHost({ jobs, changeSets: changes, stages,
    admission: createRuntimeResidentAdmission({ env, runtimeRoot, compassPath, goal, executionContractDigest: contract, workspaces: [] }),
    planning: { requirementIds: ["CORE-014"], baseRevision: base, taskScopeId: "issue:1219", maxRisk: "low",
      targetFiles: ["src/feature.ts"], contextDigest: residentDevelopmentGoalDigest(goal) } });
  const adapter = () => new CompassGoalExecutionAdapter(compassPath, {}, {}, { runtime: host() });
  return { root, runtimeRoot, compassPath, goal, goalId, jobs, changes, config, env, file, save, stages, builds, checks, create, host, adapter };
}

test("production adapter routes a public low Job to its actual hosted owner and resumes VERIFYING without another Builder", async t => {
  const f = fixture(t); await f.create();
  const first = await f.adapter().run(f.goalId);
  assert.match(first.goalEvaluation!.remainingGaps[0]!, /^independent_verifier_pending:/);
  assert.equal((await f.jobs.get("existing-job"))?.phase, "VERIFYING");
  await f.adapter().run(f.goalId);
  assert.deepEqual(f.builds, ["existing-job"]);
  assert.deepEqual(f.checks, ["existing-job", "existing-job"]);
});

test("offline physical capability yields a durable bounded wait before Builder", async t => {
  const f = fixture(t); await f.create(["device-specific"]);
  const result = await f.adapter().run(f.goalId);
  assert.match(result.goalEvaluation!.remainingGaps[0]!, /^resource_wait:/);
  assert.equal((await f.jobs.get("existing-job"))?.phase, "WAITING_FOR_RESOURCE");
  assert.equal(f.builds.length, 0);
});

test("hosted admission cannot lower a medium Job's risk to fit the cloud lane", async t => {
  const f = fixture(t); await f.create(["code-builder"], "medium");
  await f.adapter().run(f.goalId);
  assert.equal(f.builds.length, 0);
  assert.equal((await f.jobs.get("existing-job"))?.approvalScope.maxRisk, "medium");
});

test("high risk remains a Human Gate before implementation", async t => {
  const f = fixture(t); await f.create(["code-builder"], "high");
  assert.equal((await f.adapter().run(f.goalId)).stopReason, "approval_required");
  assert.equal(f.builds.length, 0);
});

test("a pinned route to another host does not run on the current process", async t => {
  const f = fixture(t); await f.create(); f.config.hostId = "other-host"; f.save();
  assert.throws(() => f.host(), /HOST_ID_MISMATCH/);
  assert.equal(f.builds.length, 0);
});

test("explicit hosted mode without pin/configuration or execution contract never falls back", t => {
  const f = fixture(t);
  const input = { env: { GORIQ_EXECUTION_HOST_MODE: "hosted" }, runtimeRoot: f.runtimeRoot, compassPath: f.compassPath, goal: f.goal, workspaces: [] };
  assert.throws(() => createRuntimeResidentAdmission(input), /HOSTED_ADMISSION_CONFIGURATION_REQUIRED/);
  assert.throws(() => createRuntimeResidentAdmission({ ...input, env: f.env }), /HOSTED_EXECUTION_CONTRACT_REQUIRED/);
});

test("route configuration is revalidated after an await before its candidate can be committed", async t => {
  const f = fixture(t); await f.create();
  const original = f.stages.build;
  f.stages.build = async input => {
    const result = await original(input);
    writeFileSync(f.file, JSON.stringify({ ...f.config, privacy: "secret" }));
    return result;
  };
  await assert.rejects(f.adapter().run(f.goalId), /HOSTED_ROUTING_PIN_MISMATCH/);
  assert.equal((await f.changes.list()).length, 0);
  assert.equal(f.checks.length, 0);
});

test("host-owned beforeWrite guard observes a pause during model inference", async t => {
  const f = fixture(t); await f.create();
  f.stages.build = async input => {
    const db = new CompassStore(f.compassPath);
    try { db.updateState({ status: "PAUSED" }); } finally { db.close(); }
    await input.beforeWrite?.();
    assert.fail("paused model result must not reach a candidate write");
  };
  const result = await f.adapter().run(f.goalId);
  assert.equal(result.stopReason, "paused");
  assert.equal((await f.changes.list()).length, 0);
});

test("a pause arriving during the guard's own store read still prevents the candidate write", async t => {
  const f = fixture(t); await f.create();
  let inWriteGuard = false, writes = 0;
  const get = f.jobs.get.bind(f.jobs);
  f.jobs.get = async id => {
    const job = await get(id);
    if (inWriteGuard) {
      const db = new CompassStore(f.compassPath);
      try { db.updateState({ status: "PAUSED" }); } finally { db.close(); }
    }
    return job;
  };
  f.stages.build = async input => {
    inWriteGuard = true; await input.beforeWrite?.(); writes++;
    assert.fail("the guard must recheck authority after its awaited reads");
  };
  assert.equal((await f.adapter().run(f.goalId)).stopReason, "paused");
  assert.equal(writes, 0);
});

test("a pause arriving during initial Job selection preserves an exhausted resource checkpoint", async t => {
  const f = fixture(t); await f.create();
  const job = (await f.jobs.get("existing-job"))!;
  const wait = nextResourceWait(undefined, { status: "WAITING_FOR_RESOURCE", reason: "fixture pressure",
    retryAfterMs: 1000, observedAt: new Date().toISOString() }, new Date());
  const waiting = new DevelopmentJobStateController().apply(job, { transitionId: "wait", actor: "state-controller",
    to: "WAITING_FOR_RESOURCE", reason: "bounded resource wait", resourceWait: { ...wait, checks: 20 } });
  await f.jobs.put(waiting);
  const persisted = await f.jobs.get("existing-job");
  const get = f.jobs.getByGoal.bind(f.jobs);
  f.jobs.getByGoal = async id => {
    const jobs = await get(id), db = new CompassStore(f.compassPath);
    try { db.updateState({ status: "PAUSED" }); } finally { db.close(); }
    return jobs;
  };
  assert.equal((await f.adapter().run(f.goalId)).stopReason, "paused");
  assert.deepEqual(await f.jobs.get("existing-job"), persisted, "pause must prevent an early terminal checkpoint write too");
});

test("a FAILED WorkRun arriving during model inference prevents the candidate write", async t => {
  const f = fixture(t); await f.create();
  f.stages.build = async input => {
    const db = new CompassStore(f.compassPath);
    try { await new CompassWorkRunStore(db).put({ ...createQueuedWorkRun(f.goalId), phase: "FAILED" }); }
    finally { db.close(); }
    await input.beforeWrite?.();
    assert.fail("a failed WorkRun is no longer runnable");
  };
  assert.equal((await f.adapter().run(f.goalId)).stopReason, "blocked");
  assert.equal((await f.changes.list()).length, 0);
});

test("resuming an in-flight Job retains the hosted public-node privacy rule", async t => {
  const f = fixture(t); await f.create();
  const job = (await f.jobs.get("existing-job"))!;
  await f.jobs.put(new DevelopmentJobStateController().apply(job, { transitionId: "recover", actor: "state-controller",
    to: "RECOVERING", reason: "resume an existing checkpoint" }));
  f.config.nodes[0]!.privacy = "local-only"; f.save();
  const result = await f.adapter().run(f.goalId);
  assert.match(result.goalEvaluation!.remainingGaps[0]!, /^resource_wait:/);
  assert.equal(f.builds.length, 0);
});

test("a second adapter cannot dispatch the same persisted Job while its writer is live", async t => {
  const f = fixture(t); await f.create();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const original = f.stages.build;
  f.stages.build = async input => { entered(); await pending; return original(input); };
  const first = f.adapter().run(f.goalId); await ready;
  try { await assert.rejects(f.adapter().run(f.goalId), ResidentExecutionBusyError); }
  finally { release(); }
  await first;
  assert.equal(f.builds.length, 1);
  assert.equal((await f.jobs.get("existing-job"))?.phase, "VERIFYING");
});

test("routing cannot authorize a direct hosted host invocation without the canonical writer", async t => {
  const f = fixture(t); await f.create();
  const result = await f.host().run({ goalId: f.goalId, goal: f.goal, context: [] });
  assert.equal(result.stopReason, "blocked");
  assert.match(result.goalEvaluation!.blockers[0]!, /EXCLUSIVE_WRITER_REQUIRED/);
  assert.equal(f.builds.length, 0);
  const noOp = await f.host().run({ goalId: f.goalId, goal: f.goal, context: [], assertExecutionAuthority: async () => {} });
  assert.equal(noOp.stopReason, "blocked", "a callback is not an execution claim");
  assert.equal(f.builds.length, 0);
});

test("a real unrelated lock and a no-op callback cannot impersonate the pinned canonical writer", async t => {
  const f = fixture(t); await f.create();
  const writer = await acquireResidentExecutionWriter(join(f.root, "unrelated.lock"), f.goalId);
  try {
    const result = await f.host().run({ goalId: f.goalId, goal: f.goal, context: [], writer, assertExecutionAuthority: async () => {} });
    assert.equal(result.stopReason, "blocked");
    assert.equal(f.builds.length, 0);
  } finally { await writer.release(); }
});

for (const waiting of [false, true]) {
  test(`an unrelated writer cannot ${waiting ? "consume a resource-wait budget" : "create a durable Job"} before routing`, async t => {
    const f = fixture(t);
    if (waiting) {
      await f.create();
      const job = (await f.jobs.get("existing-job"))!;
      const checkpoint = nextResourceWait(undefined, { status: "WAITING_FOR_RESOURCE", reason: "fixture pressure",
        retryAfterMs: 1000, observedAt: new Date().toISOString() }, new Date());
      await f.jobs.put(new DevelopmentJobStateController().apply(job, { transitionId: "wait", actor: "state-controller",
        to: "WAITING_FOR_RESOURCE", reason: "existing wait", resourceWait: { ...checkpoint, checks: 20 } }));
    }
    const before = await f.jobs.getByGoal(f.goalId);
    const writer = await acquireResidentExecutionWriter(join(f.root, "unrelated.lock"), f.goalId);
    try {
      const result = await f.host().run({ goalId: f.goalId, goal: f.goal, context: [], writer, assertExecutionAuthority: async () => {} });
      assert.equal(result.stopReason, "blocked");
      assert.deepEqual(await f.jobs.getByGoal(f.goalId), before);
      assert.equal(f.builds.length, 0);
    } finally { await writer.release(); }
  });
}

test("pinned admission reads canonical pause even when an internal caller supplies a no-op callback", async t => {
  const f = fixture(t); await f.create();
  const writer = await acquireResidentExecutionWriter(f.compassPath + ".cognitive-run.lock", f.goalId);
  const db = new CompassStore(f.compassPath);
  try {
    db.updateState({ status: "PAUSED" });
    const result = await f.host().run({ goalId: f.goalId, goal: f.goal, context: [], writer, assertExecutionAuthority: async () => {} });
    assert.equal(result.stopReason, "paused");
    assert.equal(f.builds.length, 0);
  } finally { await writer.release(); db.close(); }
});

const executor = fileURLToPath(new URL("../scripts/jarvis-goal-executor.ts", import.meta.url));
function executorEnv(f: ReturnType<typeof fixture>) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GORIQ_|JARVIS_|CODE_BUILDER_)/.test(key))),
    NODE_ENV: "test" as const, GITHUB_TOKEN: "", JARVIS_GOAL_EXECUTION_GOAL_ID: f.goalId, JARVIS_GOAL_EXECUTION_COMPASS_PATH: f.compassPath,
    GORIQ_SELF_DEVELOPMENT_RUNTIME: "1", GORIQ_SELF_DEVELOPMENT_TARGET_FILES: "src/orchestrator/goal-loop.ts" };
}

test("the real executor rejects incomplete hosted configuration before any fallback", async t => {
  const f = fixture(t), db = new CompassStore(f.compassPath), runs = new CompassWorkRunStore(db);
  try {
    await runs.put(createQueuedWorkRun(f.goalId));
    await assert.rejects(promisify(execFile)(process.execPath, [executor], { cwd: f.runtimeRoot, timeout: 5000,
      env: { ...executorEnv(f), GORIQ_EXECUTION_HOST_MODE: "hosted" } }), /HOSTED_ADMISSION_CONFIGURATION_REQUIRED/);
    assert.deepEqual((await runs.getByGoal(f.goalId))?.blockers, ["HOSTED_ADMISSION_CONFIGURATION_REQUIRED"]);
  } finally { db.close(); }
});

test("the competing real executor leaves the current owner's WorkRun runnable", async t => {
  const f = fixture(t), db = new CompassStore(f.compassPath), runs = new CompassWorkRunStore(db);
  const release = await acquireCognitiveLease(f.compassPath + ".cognitive-run.lock");
  try {
    const before = { ...createQueuedWorkRun(f.goalId), phase: "VERIFYING" as const, nextAction: "Await signed independent receipt", evidenceRefs: ["sha256:existing-authority-evidence"] };
    await runs.put(before);
    const losingWriterStatus = (error: unknown): boolean => {
      assert.equal((error as { code?: number }).code, 75,
        "the losing executor must expose the transient busy status to Broker");
      return true;
    };
    await assert.rejects(promisify(execFile)(process.execPath, [executor], {
      timeout: 5000, env: executorEnv(f),
    }), losingWriterStatus);
    await assert.rejects(promisify(execFile)(process.execPath, [executor], {
      timeout: 5000, env: { ...executorEnv(f), JARVIS_GOAL_EXECUTION_INSPECTION_ONLY: "2" },
    }), losingWriterStatus);
    const run = await runs.getByGoal(f.goalId);
    assert.deepEqual(run, before, "the losing executor must not modify phase, next action, evidence or timestamps");
  } finally { await release(); db.close(); }
});
