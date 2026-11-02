import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ResourceWaitError } from "../src/gai/development-resource-admission.ts";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { CompassGoalRegistryAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { GoalControllerRuntime } from "../src/orchestrator/goal-controller-runtime.ts";
import { OwnerRequirementIntake } from "../src/orchestrator/owner-requirement-intake.ts";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { DevelopmentJobStateController } from "../src/orchestrator/development-job.ts";
import { ResidentDevelopmentGoalHost, type ResidentDevelopmentStages } from "../src/orchestrator/resident-development-goal-host.ts";
import { residentDevelopmentGoalDigest, type ResidentDevelopmentSequence } from "../src/orchestrator/resident-development-sequence.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const goal = { title: "Implement approved artifacts", description: "Implement both approved artifact contracts",
  successCriteria: ["First exact artifact", "Second exact artifact"], constraints: ["Local scratch artifacts only"] };
const goalId = goalWorkStateId(goal), base = "a".repeat(40);

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "resident-compass-progress-")), dbPath = join(root, "compass.db");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = new CompassStore(dbPath);
  db.setGoal(goal); db.updateState({ status: "READY", blockers: [] }); db.close();
  const sequence: ResidentDevelopmentSequence = { version: 1, goalDigest: residentDevelopmentGoalDigest(goal), taskScopeId: "issue:1219",
    maxRisk: "low", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), completionMode: "verified-local-artifact",
    jobs: goal.successCriteria.map((_, index) => ({ key: `job-${index + 1}`, objective: `Create artifact ${index + 1}`,
      criterionIds: [`criterion-${index + 1}`], targetFiles: [`docs/artifact-${index + 1}.txt`], baseRevision: base })) };
  let acceptanceReady = true, builds = 0, runs = 0;
  let time = Date.now();
  const stages: ResidentDevelopmentStages = {
    deferMissingVerification: true,
    async build({ job, workItemId }) {
      builds++;
      const identity = hash(workItemId), red = workItemId.endsWith(":test");
      return createDevelopmentChangeSet({ changeSetId: workItemId, jobId: job.jobId, workItemId, deviceId: "fixture-builder",
        baseRevision: base, candidateRevision: identity, changedPaths: [`docs/artifact-${job.definitionOfDone[0]!.id.slice(-1)}.txt`],
        affectedSymbols: [], patchDigest: identity, artifactDigest: identity, artifactRef: `sha256:${identity}`, evidenceDigest: identity,
        rollback: { kind: "git-base", reference: base }, ...(red ? { tddPhase: "red", tddEvidenceDigest: identity } : {}) });
    },
    async verifyRed() { return { issuer: "fixture-verifier", digest: "b".repeat(64) }; },
    async verify({ plan }) { return plan.requiredChecks.map(check => ({ check, status: "passed", verifierId: "fixture-verifier",
      sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, recordedAt: new Date().toISOString() })); },
    async acceptanceEvidence({ job, plan }) { return acceptanceReady ? job.definitionOfDone.map(c => ({ id: `${job.jobId}:${c.id}`,
      criterionId: c.id, kind: "fixture-file-acceptance", issuer: "fixture-verifier", verified: true,
      sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, recordedAt: new Date().toISOString() })) : []; },
    async releaseState() { return { taskScopeId: "issue:1219", connected: false, protectedConditions: [],
      classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true }, pullRequest: null,
      mainCi: null, deployment: null, postDeploymentEvidence: null }; },
  };
  const host = () => new ResidentDevelopmentGoalHost({ jobs: new JsonFileDevelopmentJobStore(join(root, "jobs.json")),
    now: () => new Date(time),
    changeSets: new JsonFileDevelopmentChangeSetStore(join(root, "changes.json")), stages,
    planning: { requirementIds: ["CORE-014"], baseRevision: base, taskScopeId: "issue:1219", maxRisk: "low",
      contextDigest: hash("context"), targetFiles: ["docs/artifact-1.txt"], sequence } });
  return { dbPath, host, stages, jobs: () => new JsonFileDevelopmentJobStore(join(root, "jobs.json")),
    advance: (ms: number) => { time += ms; },
    counts: () => ({ builds, runs }), setAcceptance: (value: boolean) => { acceptanceReady = value; },
    adapter: () => {
      const runtime = host(), run = runtime.run.bind(runtime);
      runtime.run = async input => { runs++; return run(input); };
      return new CompassGoalExecutionAdapter(dbPath, {}, {}, { runtime });
    } };
}

for (const stage of ["build", "verify"] as const) {
  test(`adapter retains completed criteria while successor ${stage} waits and resumes after restart`, async t => {
    const f = fixture(t);
    await f.adapter().run(goalId);
    const first = (await f.jobs().getByGoal(goalId))[0]!;
    const original = f.stages[stage];
    let probes = 0;
    f.stages[stage] = async () => {
      probes++;
      throw new ResourceWaitError({ status: "WAITING_FOR_RESOURCE", reason: "fixture resource busy",
        retryAfterMs: 30_000, observedAt: new Date().toISOString() });
    };
    const waiting = await f.adapter().run(goalId);
    assert.equal(waiting.goalEvaluation?.achieved, false);
    assert.deepEqual(waiting.goalEvaluation?.verifiedRequired, ["criterion-1"]);
    assert.deepEqual(waiting.goalEvaluation?.unverifiedRequired, ["criterion-2"]);
    assert.ok(waiting.resourceWait);
    assert.equal((await f.jobs().getByGoal(goalId))[1]!.phase, "WAITING_FOR_RESOURCE");
    const restarted = await f.adapter().run(goalId);
    assert.deepEqual(restarted.goalEvaluation?.verifiedRequired, ["criterion-1"]);
    assert.equal(probes, 1);
    Object.assign(f.stages, { [stage]: original });
    f.advance(30_001);
    const resumed = await f.adapter().run(goalId);
    assert.equal(resumed.goalEvaluation?.achieved, true);
    assert.deepEqual(resumed.goalEvaluation?.verifiedRequired, ["criterion-1", "criterion-2"]);
    assert.deepEqual(await f.jobs().get(first.jobId), first);
  });
}

for (const stop of ["deadline", "human_gate"] as const) {
  test(`adapter preserves completed criteria when the waiting successor stops at ${stop}`, async t => {
    const f = fixture(t);
    await f.adapter().run(goalId);
    const completed = (await f.jobs().getByGoal(goalId))[0]!;
    f.stages.build = async ({ job }) => {
      if (stop === "human_gate") await f.jobs().put(new DevelopmentJobStateController().apply(job, {
        transitionId: `${job.jobId}:owner-gate`, actor: "state-controller", to: "HUMAN_GATE",
        reason: "Owner gate during admission", at: new Date(Date.parse(job.updatedAt) + 1).toISOString(),
      }));
      throw new ResourceWaitError({ status: "WAITING_FOR_RESOURCE", reason: "fixture lane busy",
        retryAfterMs: 30_000, observedAt: new Date().toISOString() });
    };
    let result = await f.adapter().run(goalId);
    if (stop === "deadline") {
      f.advance(31 * 60_000);
      result = await f.adapter().run(goalId);
    }
    assert.equal(result.goalEvaluation?.achieved, false);
    assert.equal(result.stopReason, stop === "human_gate" ? "approval_required" : "blocked");
    assert.deepEqual(result.goalEvaluation?.verifiedRequired, ["criterion-1"]);
    assert.deepEqual(result.goalEvaluation?.unverifiedRequired, ["criterion-2"]);
    assert.equal(result.resourceWait, undefined);
    assert.deepEqual(await f.jobs().get(completed.jobId), completed);
  });
}

test("resident completed criteria survive Compass restart and drive the next Goal decision", async t => {
  const f = fixture(t);
  await f.adapter().run(goalId);
  let db = new CompassStore(f.dbPath);
  try {
    const state = await new CompassWorkStateStoreAdapter(db).get(goalId);
    assert.ok(state, "resident runtime must persist Goal WorkState");
    assert.deepEqual(state.verificationResults.map(item => item.itemId), ["criterion-1"]);
    assert.deepEqual(state.constraints, goal.constraints);
    const controller = new GoalControllerRuntime({ registry: new CompassGoalRegistryAdapter(db), workStateStore: new CompassWorkStateStoreAdapter(db) });
    const decision = await controller.handle({ source: "event", text: "Continue approved artifacts", goalHint: goalId });
    assert.deepEqual(decision.remainingCriteria, ["criterion-2"]);
  } finally { db.close(); }
  f.setAcceptance(false);
  assert.equal((await f.adapter().run(goalId)).goalEvaluation?.achieved, false);
  db = new CompassStore(f.dbPath);
  try { assert.deepEqual((await new CompassWorkStateStoreAdapter(db).get(goalId))!.verificationResults.map(item => item.itemId), ["criterion-1"]); }
  finally { db.close(); }
  f.setAcceptance(true);
  assert.equal((await f.adapter().run(goalId)).goalEvaluation?.achieved, true);
  db = new CompassStore(f.dbPath);
  try {
    const state = (await new CompassWorkStateStoreAdapter(db).get(goalId))!;
    assert.equal(state.status, "COMPLETED");
    assert.deepEqual(state.verificationResults.map(item => item.itemId), ["criterion-1", "criterion-2"]);
    assert.ok(state.verificationResults.every(item => item.evidence && !item.waived));
  } finally { db.close(); }
});

test("resident completion preserves canonical requirement gates and existing WorkState constraints", async t => {
  const f = fixture(t);
  await f.adapter().run(goalId);
  const db = new CompassStore(f.dbPath);
  try {
    const store = new CompassWorkStateStoreAdapter(db), state = await store.get(goalId);
    assert.ok(state);
    await store.put({ ...state, constraints: [...state.constraints, "Preserve owner constraint"], blockers: ["owner_review_pending"] });
    const intake = new OwnerRequirementIntake(db);
    intake.capture(intake.prepare("adopt", "resident-progress", { decision: "accept", statement: "Unsynced owner requirement" }), goalId, []);
  } finally { db.close(); }
  const completed = await f.adapter().run(goalId);
  assert.equal(completed.goalEvaluation?.achieved, false);
  assert.equal(completed.stopReason, "blocked");
  assert.ok(completed.goalEvaluation?.blockers.includes("owner_review_pending"));
  assert.ok(completed.goalEvaluation?.blockers.some(item => item.startsWith("spec_sync_pending:")));
  const reopened = new CompassStore(f.dbPath);
  try { assert.deepEqual((await new CompassWorkStateStoreAdapter(reopened).get(goalId))!.constraints, [...goal.constraints, "Preserve owner constraint"]); }
  finally { reopened.close(); }
});

for (const condition of ["owner_review_pending", "spec_sync_pending", "PAUSED", "compass_blocker"] as const) {
  test(`resident sequence checks ${condition} before invoking the next Job`, async t => {
    const f = fixture(t);
    await f.adapter().run(goalId);
    const before = f.counts(), db = new CompassStore(f.dbPath);
    try {
      if (condition === "owner_review_pending") {
        const store = new CompassWorkStateStoreAdapter(db), state = (await store.get(goalId))!;
        await store.put({ ...state, blockers: ["owner_review_pending"] });
      } else if (condition === "spec_sync_pending") {
        const intake = new OwnerRequirementIntake(db);
        intake.capture(intake.prepare("adopt", "preflight", { decision: "accept", statement: "Unsynced owner requirement" }), goalId, []);
      } else if (condition === "PAUSED") db.updateState({ status: "PAUSED" });
      else db.updateState({ blockers: ["owner_review_pending"] });
    } finally { db.close(); }
    const result = await f.adapter().run(goalId);
    assert.deepEqual(f.counts(), before, "blocked or paused sequence must not invoke runtime.run or its Builder");
    assert.equal(result.stopReason, condition === "PAUSED" ? "paused" : "blocked");
    assert.equal(result.goalEvaluation?.achieved, false);
    assert.deepEqual(result.goalEvaluation?.verifiedRequired, ["criterion-1"]);
    assert.deepEqual(result.goalEvaluation?.unverifiedRequired, ["criterion-2"]);
  });
}
