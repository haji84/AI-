import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ResourceWaitError } from "../src/gai/development-resource-admission.ts";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { DevelopmentJobStateController } from "../src/orchestrator/development-job.ts";
import { ResidentDevelopmentGoalHost } from "../src/orchestrator/resident-development-goal-host.ts";
import { GoalControllerExecutionBridge } from "../src/orchestrator/goal-controller-execution-bridge.ts";
import { createRuntimeDevelopmentVerifier } from "../src/orchestrator/runtime-development-verifier.ts";

function fixture(failVerification = false) {
  const root = mkdtempSync(join(tmpdir(), "goriq-resource-resume-"));
  let time = Date.parse("2026-10-21T12:00:00Z");
  let pressure: "build" | "verify" | null = null;
  let pressureHook: ((job: import("../src/orchestrator/development-job.ts").DevelopmentJob) => Promise<void>) | undefined;
  const counts = { red: 0, green: 0, verify: 0 };
  const jobs = new JsonFileDevelopmentJobStore(join(root, "jobs.json"));
  const changes = new JsonFileDevelopmentChangeSetStore(join(root, "changes.json"));
  const goal = { title: "Implement safe resource continuation", successCriteria: ["verified"], constraints: ["preserve gates"] };
  const planning = { requirementIds: ["CORE-014"], baseRevision: "a".repeat(40), taskScopeId: "issue:1845", maxRisk: "medium" as const, targetFiles: ["src/example.ts"], contextDigest: "c".repeat(64) };
  const wait = () => new ResourceWaitError({ status: "WAITING_FOR_RESOURCE", reason: "commit limit exceeded", retryAfterMs: 30_000, observedAt: new Date(time).toISOString(), resources: { committedMemoryMb: 9900, commitLimitMb: 10000 } });
  const stages = {
    async build({ job, workItemId }: Parameters<import("../src/orchestrator/resident-development-goal-host.ts").ResidentDevelopmentStages["build"]>[0]) {
      const red = workItemId.endsWith(":test");
      if (!red && pressure === "build") { await pressureHook?.(job); throw wait(); }
      counts[red ? "red" : "green"]++;
      return createDevelopmentChangeSet({ changeSetId: job.jobId + (red ? ":red" : ":green"), jobId: job.jobId, workItemId, deviceId: "builder:fixture", baseRevision: planning.baseRevision, changedPaths: ["src/example.ts"], affectedSymbols: [], patchDigest: "b".repeat(64), artifactDigest: "b".repeat(64), evidenceDigest: "c".repeat(64), ...(red ? { tddPhase: "red" as const, tddEvidenceDigest: "d".repeat(64) } : {}), rollback: { kind: "git-base" as const, reference: planning.baseRevision } }, new Date(time));
    },
    async verify({ plan }: Parameters<import("../src/orchestrator/resident-development-goal-host.ts").ResidentDevelopmentStages["verify"]>[0]) {
      if (pressure === "verify") throw wait();
      counts.verify++;
      return plan.requiredChecks.map(check => ({ check, verifierId: "verifier:fixture", sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, status: failVerification ? "failed" as const : "passed" as const, recordedAt: new Date(time).toISOString() }));
    },
    async releaseState() { return { connected: false, taskScopeId: planning.taskScopeId, protectedConditions: [], classifications: null, pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null }; },
  };
  const host = () => new ResidentDevelopmentGoalHost({ jobs: new JsonFileDevelopmentJobStore(join(root, "jobs.json")), changeSets: new JsonFileDevelopmentChangeSetStore(join(root, "changes.json")), stages, planning, now: () => new Date(time) });
  return { jobs, freshJobs: () => new JsonFileDevelopmentJobStore(join(root, "jobs.json")), setPressureHook: (hook: typeof pressureHook) => { pressureHook = hook; }, changes, counts, goal, host, run: () => host().run({ goalId: "g", goal, context: [] }), setPressure: (p: typeof pressure) => { pressure = p; }, advance: (ms = 30_001) => { time += ms; }, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("verification pressure persists a wait without rejecting the ChangeSet or consuming a failure attempt; restart and relief verify once", async () => {
  const f = fixture();
  try {
    f.setPressure("verify");
    const waiting = await f.run();
    assert.ok(waiting.goalEvaluation?.remainingGaps.some(gap => gap.startsWith("resource_wait:")));
    const before = (await f.jobs.getByGoal("g"))[0]!;
    assert.equal(before.phase, "WAITING_FOR_RESOURCE");
    assert.equal(before.attempts.length, 0);
    assert.equal((await f.changes.list()).filter(c => c.status === "REJECTED").length, 0);
    const saved = (await f.changes.list()).find(c => c.tddPhase !== "red")!;
    f.setPressure(null);
    await f.run();
    assert.equal(f.counts.verify, 0, "not before persisted due time");
    f.advance();
    await f.run();
    assert.equal(f.counts.verify, 1);
    assert.deepEqual({ red: f.counts.red, green: f.counts.green }, { red: 1, green: 1 });
    assert.equal((await f.changes.list()).find(c => c.changeSetId === saved.changeSetId)?.artifactDigest, saved.artifactDigest);
  } finally { f.dispose(); }
});

test("pressure after TDD red preserves that checkpoint across process recreation", async () => {
  const f = fixture();
  try {
    f.setPressure("build");
    await f.run();
    assert.deepEqual(f.counts, { red: 1, green: 0, verify: 0 });
    f.setPressure(null); f.advance();
    await f.run();
    assert.deepEqual(f.counts, { red: 1, green: 1, verify: 1 });
    assert.equal((await f.jobs.getByGoal("g"))[0]!.attempts.length, 0);
  } finally { f.dispose(); }
});

test("a genuine failed verification after pressure relief rejects the candidate and consumes a failure attempt", async () => {
  const f = fixture(true);
  try {
    f.setPressure("verify"); await f.run();
    f.setPressure(null); f.advance();
    const result = await f.run();
    assert.equal(result.stopReason, "blocked");
    const job = (await f.jobs.getByGoal("g"))[0]!;
    assert.equal(job.phase, "RECOVERING"); assert.equal(job.attempts.length, 1);
    assert.ok((await f.changes.list()).some(change => change.status === "REJECTED"));
    assert.equal(result.resourceWait, undefined);
  } finally { f.dispose(); }
});

test("pressure wait has a persistent deadline and does not restart its budget after process recreation", async () => {
  const f = fixture();
  try {
    f.setPressure("build"); await f.run();
    f.advance(31 * 60_000);
    const report = await f.run();
    assert.equal(report.stopReason, "blocked");
    const job = (await f.jobs.getByGoal("g"))[0]!;
    assert.equal(job.phase, "BLOCKED");
    assert.ok(job.blockers.includes("resource_wait_budget_exhausted"));
    assert.equal(job.attempts.length, 0);
    assert.equal(f.counts.green, 0);
  } finally { f.dispose(); }
});

test("Human Gate committed while waiting prevents automatic build or verification resume", async () => {
  const f = fixture();
  try {
    f.setPressure("build"); await f.run();
    const job = (await f.jobs.getByGoal("g"))[0]!;
    await f.jobs.put(new DevelopmentJobStateController().apply(job, { transitionId: "owner-gate", actor: "state-controller", to: "HUMAN_GATE", reason: "owner gate" }));
    f.setPressure(null); f.advance();
    const report = await f.run();
    assert.equal(report.stopReason, "approval_required");
    assert.equal(f.counts.green, 0);
  } finally { f.dispose(); }
});

test("Human Gate committed during awaited admission survives a later resource-wait result", async () => {
  const f = fixture();
  try {
    f.setPressure("build");
    f.setPressureHook(async job => {
      const store = f.freshJobs();
      const latest = (await store.getByGoal("g"))[0]!;
      await store.put(new DevelopmentJobStateController().apply(latest, { transitionId: "in-flight-owner-gate", actor: "state-controller", to: "HUMAN_GATE", reason: "owner gate", at: new Date(Date.parse(job.updatedAt) + 100).toISOString() }));
      f.advance(1000);
    });
    const result = await f.run();
    assert.equal(result.stopReason, "approval_required");
    const job = (await f.freshJobs().getByGoal("g"))[0]!;
    assert.equal(job.phase, "HUMAN_GATE");
    assert.ok(job.history.some(entry => entry.transitionId === "in-flight-owner-gate"));
  } finally { f.dispose(); }
});

test("twenty pressure observations exhaust the same persisted budget without consuming failure attempts", async () => {
  const f = fixture();
  try {
    f.setPressure("build");
    for (let n = 0; n < 20; n++) { await f.run(); f.advance(); }
    assert.equal((await f.jobs.getByGoal("g"))[0]!.resourceWait?.checks, 20);
    const result = await f.run();
    assert.equal(result.stopReason, "blocked");
    assert.equal((await f.jobs.getByGoal("g"))[0]!.attempts.length, 0);
  } finally { f.dispose(); }
});

test("execution bridge yields on a resource wait rather than repeatedly invoking the adapter", async () => {
  let runs = 0;
  const bridge = new GoalControllerExecutionBridge({ async run() { runs++; return { cycles: [], stopReason: "cycle_budget_exhausted", goalEvaluation: { achieved: false, verifiedRequired: [], failedRequired: [], unverifiedRequired: ["development"], blockers: [], remainingGaps: ["resource_wait:commit limit exceeded"] } }; } });
  const result = await bridge.executeUntilGoalTerminal({ action: "CONTINUE_GOAL", goalId: "g" } as never, { maxRuns: 12 });
  assert.equal(result.reason, "resource_wait");
  assert.equal(runs, 1);
});

test("HTTP verifier keeps a resource wait distinguishable from failed test evidence", async () => {
  const resourceWait = { status: "WAITING_FOR_RESOURCE", reason: "heavy execution lane unavailable", retryAfterMs: 30_000, observedAt: "2026-10-21T12:00:00Z" };
  const verifier = createRuntimeDevelopmentVerifier({ CODE_BUILDER_LOCAL_TOKEN: "fixture-token" }, async () => new Response(JSON.stringify({ ok: false, blocker: "WAITING_FOR_RESOURCE", resourceWait }), { status: 503 }));
  const result = await verifier.verify({ goal: { title: "Build", successCriteria: [], constraints: [] }, action: { id: "a", capability: "code.builder", description: "verify", risk: "low", input: { verificationContract: { kind: "repository_checks", profile: "standard", requiredChecks: ["unit"] } } }, result: { actionId: "a", ok: true, summary: "candidate" }, context: [] });
  assert.equal((result.evidence as { resourceWait?: unknown })?.resourceWait && (result.evidence as { resourceWait: { status: string } }).resourceWait.status, "WAITING_FOR_RESOURCE");
  assert.equal(result.ok, false);
});
