import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { createDevelopmentJob, DevelopmentJobStateController, type DevelopmentJob } from "../src/orchestrator/development-job.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { ResidentDevelopmentGoalHost, type ResidentDevelopmentStages } from "../src/orchestrator/resident-development-goal-host.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";

const BASE = "a".repeat(40), REVISION = "b".repeat(40), ARTIFACT = "c".repeat(64);
const NOW = new Date("2026-10-19T00:00:00.000Z");
const request = {
  goalId: "goal-next-job",
  goal: { title: "Implement two bounded parts", successCriteria: ["first part", "second part"], constraints: [] },
  context: [],
};

function queuedJob(id: string): DevelopmentJob {
  return createDevelopmentJob({
    jobId: id, goalId: request.goalId, requirementIds: ["CORE-014"],
    acceptanceCriteria: [`${id} accepted`],
    definitionOfDone: [{ id: `${id}:acceptance`, description: `${id} accepted`, required: true }],
    baseRevision: BASE, approvalScope: { taskScopeId: "issue:1219", maxRisk: "low" },
    workItems: [{ id: `${id}:implement`, objective: `Implement ${id}`, dependsOn: [], requiredCapabilities: ["code-builder"] }],
  }, NOW);
}

function completedJob(id: string): DevelopmentJob {
  const controller = new DevelopmentJobStateController();
  let job = queuedJob(id);
  for (const phase of ["PLANNING", "IMPLEMENTING", "VERIFYING", "COMPLETED"] as const) {
    job = controller.apply(job, {
      transitionId: `${id}:${phase}`, actor: "state-controller", to: phase,
      reason: "Seed prior completed Job for software recovery regression", at: NOW.toISOString(),
      ...(phase === "COMPLETED" ? { evidence: [{
        id: `${id}:acceptance`, criterionId: `${id}:acceptance`, kind: "test-fixture",
        issuer: "fixture-verifier", verified: true, sourceRevision: REVISION,
        artifactDigest: ARTIFACT, recordedAt: NOW.toISOString(),
      }] } : {}),
    });
  }
  return job;
}

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "goriq-next-job-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const jobsPath = join(root, "jobs.json"), changesPath = join(root, "changes.json");
  const builds: string[] = [];
  const stages: ResidentDevelopmentStages = {
    deferMissingVerification: true,
    async build({ job, workItemId }) {
      builds.push(job.jobId);
      return createDevelopmentChangeSet({
        changeSetId: `${job.jobId}:change`, jobId: job.jobId, workItemId,
        deviceId: "fixture-builder", baseRevision: BASE, candidateRevision: REVISION,
        changedPaths: [`src/${job.jobId}.ts`], affectedSymbols: [],
        patchDigest: ARTIFACT, artifactDigest: ARTIFACT, artifactRef: `sha256:${ARTIFACT}`,
        evidenceDigest: "d".repeat(64), rollback: { kind: "git-base", reference: BASE },
      }, NOW);
    },
    async verify() { return []; },
    async releaseState() { throw new Error("Missing verification must not reach release"); },
  };
  return {
    builds, stages,
    jobs: () => new JsonFileDevelopmentJobStore(jobsPath),
    changes: () => new JsonFileDevelopmentChangeSetStore(changesPath),
    host: () => new ResidentDevelopmentGoalHost({
      jobs: new JsonFileDevelopmentJobStore(jobsPath),
      changeSets: new JsonFileDevelopmentChangeSetStore(changesPath), stages,
      planning: { requirementIds: ["CORE-014"], baseRevision: BASE, taskScopeId: "issue:1219",
        maxRisk: "low", targetFiles: ["src/next.ts"], contextDigest: "e".repeat(64) },
    }),
  };
}

test("restart selects the persisted unfinished Job after a completed Job without rebuilding either candidate", async t => {
  const f = fixture(t);
  const completed = completedJob("job-a");
  await f.jobs().put(completed);
  await f.jobs().put(queuedJob("job-b"));
  const persistedCompleted = await f.jobs().get("job-a");

  const first = await f.host().run(request);
  assert.equal(first.goalEvaluation?.achieved, false);
  assert.match(first.goalEvaluation!.remainingGaps[0]!, /^independent_verifier_pending:/);
  assert.equal((await f.jobs().get("job-b"))?.phase, "VERIFYING");
  assert.deepEqual(f.builds, ["job-b"]);
  assert.deepEqual((await f.changes().list()).map(change => [change.jobId, change.changeSetId, change.status]),
    [["job-b", "job-b:change", "LOCAL"]]);

  const resumed = await f.host().run(request);
  assert.equal(resumed.goalEvaluation?.achieved, false);
  assert.deepEqual(f.builds, ["job-b"]);
  assert.equal((await f.changes().list()).length, 1);
  assert.deepEqual((await f.jobs().getByGoal(request.goalId)).map(job => [job.jobId, job.phase]),
    [["job-a", "COMPLETED"], ["job-b", "VERIFYING"]]);
  assert.deepEqual(await f.jobs().get("job-a"), persistedCompleted);
});

for (const phase of ["HUMAN_GATE", "BLOCKED"] as const) {
  test(`restart preserves ${phase} on the next Job instead of skipping to later work`, async t => {
    const f = fixture(t);
    await f.jobs().put(completedJob("job-a"));
    const stopped = new DevelopmentJobStateController().apply(queuedJob("job-b"), {
      transitionId: `job-b:${phase}`, actor: "state-controller", to: phase,
      reason: "Existing stop condition", blockers: ["existing_stop"], at: NOW.toISOString(),
    });
    await f.jobs().put(stopped);
    await f.jobs().put(queuedJob("job-c"));
    const persistedStop = await f.jobs().get("job-b");
    const result = await f.host().run(request);
    assert.equal(result.goalEvaluation?.achieved, false);
    assert.equal(result.stopReason, phase === "HUMAN_GATE" ? "approval_required" : "blocked");
    assert.deepEqual(f.builds, []);
    assert.deepEqual(await f.jobs().get("job-b"), persistedStop);
    assert.equal((await f.jobs().get("job-c"))?.phase, "QUEUED");
    assert.deepEqual(await f.changes().list(), []);
  });
}

test("restart of a fully completed persisted Goal creates no additional Job", async t => {
  const f = fixture(t);
  await f.jobs().put(completedJob("job-a"));
  await f.jobs().put(completedJob("job-b"));
  const result = await f.host().run(request);
  assert.equal(result.goalEvaluation?.achieved, true);
  assert.deepEqual(f.builds, []);
  assert.deepEqual((await f.jobs().getByGoal(request.goalId)).map(job => job.jobId), ["job-a", "job-b"]);
});

test("completing one Job leaves the Goal open while a second persisted Job remains", async t => {
  const f = fixture(t);
  await f.jobs().put(queuedJob("job-a"));
  await f.jobs().put(queuedJob("job-b"));
  // These are software contract fixtures, not physical/release verification evidence.
  f.stages.verify = async ({ plan }) => plan.requiredChecks.map(check => ({
    check, verifierId: "fixture-verifier", sourceRevision: REVISION,
    artifactDigest: ARTIFACT, status: "passed", recordedAt: NOW.toISOString(),
  }));
  f.stages.acceptanceEvidence = async ({ job }) => [{
    id: `${job.jobId}:acceptance`, criterionId: `${job.jobId}:acceptance`, kind: "test-fixture",
    issuer: "fixture-verifier", verified: true, sourceRevision: REVISION,
    artifactDigest: ARTIFACT, recordedAt: NOW.toISOString(),
  }];
  f.stages.releaseState = async () => ({
    connected: true, taskScopeId: "issue:1219",
    taskAuthorization: createTaskCompletionAuthorization("Issue #1219を完成させて", { now: NOW }),
    protectedConditions: [], classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true },
    pullRequest: { url: "https://github.com/example/fixture/pull/1", headRevision: REVISION,
      candidateRevision: REVISION, baseBranch: "main", draft: false, autoMergeEnabled: true,
      mergedRevision: REVISION, reviewerPassed: true, unresolvedReviewThreads: 0,
      requiredChecksPassed: true, mergeable: true, baseRevisionCurrent: true },
    mainCi: { revision: REVISION, artifactDigest: ARTIFACT, passed: true },
    deployment: { revision: REVISION, sourceCandidateRevision: REVISION, sourceArtifactDigest: ARTIFACT,
      artifactDigest: ARTIFACT, environment: "production" },
    postDeploymentEvidence: { verifierId: "fixture-verifier", revision: REVISION,
      artifactDigest: ARTIFACT, passed: true, recordedAt: NOW.toISOString() }, now: NOW,
  });

  const first = await f.host().run(request);
  assert.equal((await f.jobs().get("job-a"))?.phase, "COMPLETED");
  assert.equal((await f.jobs().get("job-b"))?.phase, "QUEUED");
  assert.equal(first.goalEvaluation?.achieved, false);
  assert.equal(first.stopReason, "cycle_budget_exhausted");
  const second = await f.host().run(request);
  assert.equal(second.goalEvaluation?.achieved, true);
  assert.deepEqual((await f.jobs().getByGoal(request.goalId)).map(job => [job.jobId, job.phase]),
    [["job-a", "COMPLETED"], ["job-b", "COMPLETED"]]);
  assert.deepEqual(f.builds, ["job-a", "job-b"]);
  assert.equal((await f.host().run(request)).goalEvaluation?.achieved, true);
  assert.deepEqual(f.builds, ["job-a", "job-b"]);
});
