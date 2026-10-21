import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { createDevelopmentJob } from "../src/orchestrator/development-job.ts";
import { ResidentDevelopmentGoalHost, type ResidentDevelopmentStages } from "../src/orchestrator/resident-development-goal-host.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const BASE = "a".repeat(40);
const goal = { title: "Implement two local artifacts", description: "Create the two pinned scratch files",
  successCriteria: ["The first artifact contains alpha", "The second artifact contains beta"], constraints: ["Local artifacts only"] };
const request = { goalId: "sequence-goal", goal, context: [] };
function sequence() {
  return { version: 1 as const, goalDigest: hash(JSON.stringify(goal)), taskScopeId: "issue:1219", maxRisk: "low" as const,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), completionMode: "verified-local-artifact" as "release" | "verified-local-artifact",
    jobs: [
      { key: "first", objective: "Create the first pinned artifact", criterionIds: ["criterion-1"], targetFiles: ["docs/first.txt"], baseRevision: BASE },
      { key: "second", objective: "Create the second pinned artifact", criterionIds: ["criterion-2"], targetFiles: ["docs/second.txt"], baseRevision: BASE },
    ] };
}

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "goriq-resident-sequence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const jobsFile = join(root, "jobs.json"), changesFile = join(root, "changes.json");
  const approved = sequence(), builds: string[] = [];
  let acceptanceReady = true;
  const stages: ResidentDevelopmentStages = {
    deferMissingVerification: true,
    async build({ job, workItemId }) {
      builds.push(workItemId);
      const red = workItemId.endsWith(":test");
      const identity = hash(workItemId);
      return createDevelopmentChangeSet({ changeSetId: workItemId, jobId: job.jobId, workItemId,
        deviceId: "fixture-builder", baseRevision: job.baseRevision, candidateRevision: identity,
        changedPaths: [job.definitionOfDone[0]!.id === "criterion-1" ? "docs/first.txt" : "docs/second.txt"],
        affectedSymbols: [], patchDigest: identity, artifactDigest: identity, artifactRef: `sha256:${identity}`,
        evidenceDigest: identity, rollback: { kind: "git-base", reference: job.baseRevision },
        ...(red ? { tddPhase: "red", tddEvidenceDigest: identity } : {}) });
    },
    async verifyRed() { return { digest: "b".repeat(64), issuer: "fixture-verifier" }; },
    async verify({ plan }) { return plan.requiredChecks.map(check => ({ check, verifierId: "fixture-verifier",
      sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, status: "passed", recordedAt: new Date().toISOString() })); },
    async acceptanceEvidence({ job, plan }) { return acceptanceReady ? job.definitionOfDone.map(criterion => ({
      id: `${job.jobId}:${criterion.id}:acceptance`, criterionId: criterion.id, kind: "acceptance:file-exact:fixture",
      issuer: "fixture-verifier", verified: true, sourceRevision: plan.sourceRevision,
      artifactDigest: plan.artifactDigest, recordedAt: new Date().toISOString(),
    })) : []; },
    async releaseState() { return { connected: false, taskScopeId: "issue:1219", protectedConditions: [],
      classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true },
      pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null }; },
    async executeRelease() { throw Error("Local artifact completion must never publish"); },
  };
  return { approved, builds, stages, setAcceptance: (ready: boolean) => { acceptanceReady = ready; },
    jobs: () => new JsonFileDevelopmentJobStore(jobsFile), changes: () => new JsonFileDevelopmentChangeSetStore(changesFile),
    host: (plan = approved) => new ResidentDevelopmentGoalHost({ jobs: new JsonFileDevelopmentJobStore(jobsFile),
      changeSets: new JsonFileDevelopmentChangeSetStore(changesFile), stages,
      planning: { requirementIds: ["CORE-014"], baseRevision: BASE, taskScopeId: "issue:1219", maxRisk: "low",
        targetFiles: ["docs/first.txt"], contextDigest: "d".repeat(64), sequence: plan } }),
  };
}

test("an approved sequence creates its next Job after restart and reports only completed global criteria", async t => {
  const f = fixture(t);
  const first = await f.host().run(request);
  assert.equal(first.goalEvaluation?.achieved, false);
  assert.deepEqual(first.goalEvaluation?.verifiedRequired, ["criterion-1"]);
  assert.deepEqual(first.goalEvaluation?.unverifiedRequired, ["criterion-2"]);
  const firstJob = (await f.jobs().getByGoal(request.goalId))[0]!;
  assert.equal(firstJob.phase, "COMPLETED");
  assert.deepEqual(firstJob.definitionOfDone.map(c => c.id), ["criterion-1"]);

  const resumed = await f.host().run(request);
  assert.equal(resumed.goalEvaluation?.achieved, true);
  assert.deepEqual(resumed.goalEvaluation?.verifiedRequired, ["criterion-1", "criterion-2"]);
  const jobs = await f.jobs().getByGoal(request.goalId);
  assert.equal(jobs.length, 2);
  assert.notEqual(jobs[0]!.jobId, jobs[1]!.jobId);
  assert.deepEqual(jobs[1]!.definitionOfDone.map(c => c.id), ["criterion-2"]);
  assert.equal(jobs[1]!.phase, "COMPLETED");
  const count = f.builds.length;
  assert.equal((await f.host().run(request)).goalEvaluation?.achieved, true);
  assert.equal(f.builds.length, count);
  assert.deepEqual(await f.jobs().get(firstJob.jobId), firstJob);
});

test("missing acceptance stays resumable before READY and later proof completes without rebuilding", async t => {
  const f = fixture(t);
  f.setAcceptance(false);
  const waiting = await f.host().run(request);
  assert.equal(waiting.goalEvaluation?.achieved, false);
  assert.match(waiting.goalEvaluation!.remainingGaps[0]!, /^independent_verifier_pending:/);
  assert.equal((await f.jobs().getByGoal(request.goalId))[0]!.phase, "VERIFYING");
  const implementation = (await f.changes().list()).find(c => c.workItemId.endsWith(":implement"))!;
  assert.equal(implementation.status, "LOCAL");
  const count = f.builds.length;
  f.setAcceptance(true);
  const resumed = await f.host().run(request);
  assert.deepEqual(resumed.goalEvaluation?.verifiedRequired, ["criterion-1"]);
  assert.equal(f.builds.length, count);
});

test("completed Job cannot be reused after the trusted sequence or locked Goal changes", async t => {
  const f = fixture(t);
  await f.host().run(request);
  const changed = structuredClone(f.approved);
  changed.jobs[1]!.targetFiles = ["docs/replacement.txt"];
  await assert.rejects(() => f.host(changed).run(request), /SEQUENCE.*(MISMATCH|DRIFT)/);
  await assert.rejects(() => f.host().run({ ...request, goal: { ...goal, successCriteria: [...goal.successCriteria, "another outcome"] } }), /SEQUENCE.*GOAL/);
  assert.equal((await f.jobs().getByGoal(request.goalId)).length, 1);
});

for (const [name, change] of [
  ["expired", (p: ReturnType<typeof sequence>) => { p.expiresAt = new Date(Date.now() - 1000).toISOString(); }],
  ["different scope", (p: ReturnType<typeof sequence>) => { p.taskScopeId = "another-task"; }],
  ["duplicate criterion", (p: ReturnType<typeof sequence>) => { p.jobs[1]!.criterionIds = ["criterion-1"]; }],
  ["unassigned criterion", (p: ReturnType<typeof sequence>) => { p.jobs.pop(); }],
  ["unknown criterion", (p: ReturnType<typeof sequence>) => { p.jobs[1]!.criterionIds = ["criterion-99"]; }],
  ["duplicate key", (p: ReturnType<typeof sequence>) => { p.jobs[1]!.key = "first"; }],
  ["unsafe path", (p: ReturnType<typeof sequence>) => { p.jobs[1]!.targetFiles = ["../outside"]; }],
] as const) {
  test(`invalid ${name} sequence cannot create or execute a Job`, async t => {
    const f = fixture(t), invalid = structuredClone(f.approved);
    change(invalid);
    await assert.rejects(() => f.host(invalid).run(request), /SEQUENCE/);
    assert.deepEqual(await f.jobs().list(), []);
    assert.deepEqual(f.builds, []);
  });
}

test("a trusted sequence cannot adopt an unrelated legacy Job", async t => {
  const f = fixture(t);
  const legacy = createDevelopmentJob({ jobId: "legacy", goalId: request.goalId, requirementIds: ["CORE-014"],
    acceptanceCriteria: [goal.successCriteria[0]!], definitionOfDone: [{ id: "criterion-1", description: goal.successCriteria[0]!, required: true }],
    baseRevision: BASE, approvalScope: { taskScopeId: "issue:1219", maxRisk: "low" },
    workItems: [{ id: "legacy:implement", objective: "legacy", dependsOn: [], requiredCapabilities: ["code-builder"] }] });
  await f.jobs().put(legacy);
  await assert.rejects(() => f.host().run(request), /SEQUENCE.*(MISMATCH|DRIFT)/);
  assert.deepEqual(f.builds, []);
});

test("local artifact completion retains protected Human Gates", async t => {
  const f = fixture(t), original = f.stages.releaseState;
  f.stages.releaseState = async input => ({ ...await original(input), protectedConditions: ["permission_or_token_scope"] });
  const result = await f.host().run(request);
  assert.equal(result.stopReason, "approval_required");
  assert.equal((await f.jobs().getByGoal(request.goalId))[0]!.phase, "HUMAN_GATE");
  assert.deepEqual(result.goalEvaluation?.verifiedRequired, []);
  assert.equal((await f.jobs().getByGoal(request.goalId)).length, 1);
});

test("a release sequence still requires the original release authorization gate", async t => {
  const f = fixture(t);
  f.approved.completionMode = "release";
  const result = await f.host().run(request);
  assert.equal(result.stopReason, "approval_required");
  assert.equal(result.goalEvaluation?.achieved, false);
});

test("local completion refuses acceptance for another artifact without advancing the sequence", async t => {
  const f = fixture(t), original = f.stages.acceptanceEvidence!;
  f.stages.acceptanceEvidence = async input => (await original(input)).map(item => ({ ...item, artifactDigest: "f".repeat(64) }));
  const result = await f.host().run(request);
  assert.equal(result.goalEvaluation?.achieved, false);
  assert.ok(result.goalEvaluation?.blockers.includes("acceptance_evidence_invalid"));
  assert.equal((await f.jobs().getByGoal(request.goalId))[0]!.phase, "VERIFYING");
});

test("local completion requires trusted non-destructive and non-privileged classification", async t => {
  const f = fixture(t), original = f.stages.releaseState;
  f.stages.releaseState = async input => ({ ...await original(input), classifications: null });
  const result = await f.host().run(request);
  assert.equal(result.stopReason, "blocked");
  assert.deepEqual(result.goalEvaluation?.verifiedRequired, []);
  assert.equal((await f.jobs().getByGoal(request.goalId))[0]!.phase, "BLOCKED");
});

test("local completion rejects stale acceptance and check timestamps", async t => {
  const f = fixture(t), original = f.stages.acceptanceEvidence!, verify = f.stages.verify;
  const stale = new Date(Date.now() - 3_600_000).toISOString();
  f.stages.acceptanceEvidence = async input => (await original(input)).map(item => ({ ...item, recordedAt: stale }));
  assert.ok((await f.host().run(request)).goalEvaluation?.blockers.includes("acceptance_evidence_invalid"));
  f.stages.acceptanceEvidence = original;
  f.stages.verify = async input => (await verify(input)).map(item => ({ ...item, recordedAt: stale }));
  const result = await f.host().run(request);
  assert.equal(result.goalEvaluation?.achieved, false);
  assert.deepEqual(result.goalEvaluation?.verifiedRequired, []);
  assert.ok(result.goalEvaluation?.blockers.includes("verification_evidence_stale"));
});

test("expiry during verification cannot complete a local artifact", async t => {
  const f = fixture(t), original = f.stages.releaseState;
  f.stages.releaseState = async input => {
    f.approved.expiresAt = new Date(Date.now() - 1000).toISOString();
    return original(input);
  };
  await assert.rejects(() => f.host().run(request), /SEQUENCE_EXPIRED/);
  assert.equal((await f.jobs().getByGoal(request.goalId))[0]!.phase, "VERIFYING");
});

test("a Builder cannot widen the pinned sequence Job paths", async t => {
  const f = fixture(t), original = f.stages.build;
  f.stages.build = async input => ({ ...await original(input), changedPaths: ["outside/unauthorized.txt"] });
  await assert.rejects(() => f.host().run(request), /SEQUENCE_CHANGESET_SCOPE_MISMATCH/);
  assert.equal(f.builds.length, 1);
  assert.deepEqual(await f.changes().list(), []);
});

test("a sequence cannot be removed when resuming its durable Jobs", async t => {
  const f = fixture(t);
  await f.host().run(request);
  const unbound = new ResidentDevelopmentGoalHost({ jobs: f.jobs(), changeSets: f.changes(), stages: f.stages,
    planning: { requirementIds: ["CORE-014"], baseRevision: BASE, taskScopeId: "issue:1219", maxRisk: "low",
      targetFiles: ["docs/first.txt"], contextDigest: "d".repeat(64) } });
  await assert.rejects(() => unbound.run(request), /SEQUENCE_PERSISTED_JOB_MISMATCH/);
});
