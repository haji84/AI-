import { DevelopmentJobStateController } from "../src/orchestrator/development-job.ts";
import { DevelopmentOrchestrator } from "../src/orchestrator/development-orchestrator.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { CompassGoalRegistryAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import {
  ResidentDevelopmentGoalHost,
  type ResidentDevelopmentStages,
  type ResidentDevelopmentReleaseState,
} from "../src/orchestrator/resident-development-goal-host.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const BASE_REVISION = "a".repeat(40);
const REVISION = "d".repeat(40);
const ARTIFACT = "b".repeat(64);

test("resident Goal path resumes one durable Change Set without duplicate build, verification, or release effects", async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-self-development-runtime-"));
  try {
    const compassPath = join(root, "compass.sqlite");
    const compass = new CompassStore(compassPath);
    const active = await new CompassGoalRegistryAdapter(compass).create({
      title: "Implement durable self-development release",
      description: "Change src/orchestrator/example.ts",
      successCriteria: ["verified Production release"],
      constraints: ["preserve Human Gates"],
    });
    compass.close();

    let connected = false;
    let builds = 0;
    let verifications = 0;
    const releaseEffects: string[] = [];
    const authorization = createTaskCompletionAuthorization("Issue #681を完成させて", { now: NOW });
    assert.ok(authorization);
    let releaseState: ResidentDevelopmentReleaseState = {
      connected,
      taskScopeId: "issue:681",
      taskAuthorization: authorization,
      protectedConditions: [],
      classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true },
      pullRequest: null,
      mainCi: null,
      deployment: null,
      postDeploymentEvidence: null,
      now: NOW,
    };

    const stages: ResidentDevelopmentStages = {
      async build(input: { job: { jobId: string; goalId: string }; workItemId: string }) {
        builds += 1;
        const red = input.workItemId.endsWith(":test");
        return createDevelopmentChangeSet({
          changeSetId: `change-${input.job.jobId}-${red ? "red" : "green"}`,
          jobId: input.job.jobId,
          workItemId: input.workItemId,
          deviceId: "zbook-1",
          baseRevision: BASE_REVISION,
          candidateRevision: REVISION,
          changedPaths: ["src/orchestrator/example.ts"],
          affectedSymbols: ["example"],
          patchDigest: ARTIFACT,
          artifactDigest: ARTIFACT,
          artifactRef: `sha256:${ARTIFACT}`,
          ...(red ? { tddPhase: "red" as const, tddEvidenceDigest: "e".repeat(64) } : {}),
          evidenceDigest: "c".repeat(64),
          rollback: { kind: "git-base" as const, reference: BASE_REVISION },
        }, NOW);
      },
      async verify(input) {
        verifications += 1;
        return input.plan.requiredChecks.map((check) => ({
          check,
          verifierId: "verifier:macbook",
          sourceRevision: input.plan.sourceRevision,
          artifactDigest: input.plan.artifactDigest,
          status: "passed" as const,
          recordedAt: NOW.toISOString(),
        }));
      },
      async acceptanceEvidence({ job, plan }) {
        return job.definitionOfDone.map((criterion) => ({ id: `${job.jobId}:${criterion.id}`, criterionId: criterion.id, kind: "acceptance", issuer: "verifier:macbook", verified: true, sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, recordedAt: NOW.toISOString() }));
      },
      async releaseState() { return { ...releaseState, connected }; },
      async executeRelease(action: string) {
        releaseEffects.push(action);
        if (action === "OPEN_PR") {
          releaseState = {
            ...releaseState,
            pullRequest: {
              url: "https://github.example/pr/681",
              headRevision: REVISION,
              candidateRevision: REVISION,
              baseBranch: "main",
              draft: false,
              autoMergeEnabled: true,
              mergedRevision: REVISION,
              reviewerPassed: true,
              unresolvedReviewThreads: 0,
              requiredChecksPassed: true,
              mergeable: true,
              baseRevisionCurrent: true,
            },
            mainCi: { revision: REVISION, artifactDigest: ARTIFACT, passed: true },
          };
        } else if (action === "DEPLOY_PRODUCTION") {
          releaseState = {
            ...releaseState,
            deployment: { revision: REVISION, sourceCandidateRevision: REVISION, sourceArtifactDigest: ARTIFACT, artifactDigest: ARTIFACT, environment: "production" as const },
            postDeploymentEvidence: {
              verifierId: "verifier:iphone-1",
              revision: REVISION,
              artifactDigest: ARTIFACT,
              passed: true,
              recordedAt: NOW.toISOString(),
            },
          };
        }
      },
    };

    const runtime = () => new ResidentDevelopmentGoalHost({
      jobs: new JsonFileDevelopmentJobStore(join(root, "jobs.json")),
      changeSets: new JsonFileDevelopmentChangeSetStore(join(root, "changes.json")),
      stages,
      planning: {
        requirementIds: ["CORE-014"],
        baseRevision: BASE_REVISION,
        taskScopeId: "issue:681",
        maxRisk: "medium",
        targetFiles: ["src/orchestrator/example.ts"],
        contextDigest: "d".repeat(64),
      },
    });
    const first = new CompassGoalExecutionAdapter(compassPath, {}, {}, { runtime: runtime() });
    const offline = await first.run(active.goalId);
    assert.equal(offline.stopReason, "cycle_budget_exhausted");
    assert.equal(builds, 2);
    assert.equal(verifications, 1);
    assert.deepEqual(releaseEffects, []);

    connected = true;
    const restarted = new CompassGoalExecutionAdapter(compassPath, {}, {}, { runtime: runtime() });
    let final = await restarted.run(active.goalId);
    final = await restarted.run(active.goalId);
    final = await restarted.run(active.goalId);
    assert.equal(final.stopReason, "goal_complete");
    assert.equal(final.goalEvaluation?.achieved, true);
    assert.equal(builds, 2);
    assert.equal(verifications, 1);
    assert.deepEqual(releaseEffects, ["OPEN_PR", "DEPLOY_PRODUCTION"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resident Goal path rejects authorization state for another durable Job scope", async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-self-development-scope-"));
  try {
    const authorization = createTaskCompletionAuthorization("Issue #999を完成させて", { now: NOW });
    assert.ok(authorization);
    let releases = 0;
    const host = new ResidentDevelopmentGoalHost({
      jobs: new JsonFileDevelopmentJobStore(join(root, "jobs.json")),
      changeSets: new JsonFileDevelopmentChangeSetStore(join(root, "changes.json")),
      planning: { requirementIds: ["CORE-014"], baseRevision: BASE_REVISION, taskScopeId: "issue:681", maxRisk: "medium", targetFiles: ["src/a.ts"], contextDigest: "d".repeat(64) },
      stages: {
        builderId: "builder:zbook",
        async build({ job, workItemId }) { const red = workItemId.endsWith(":test"); return createDevelopmentChangeSet({ changeSetId: `c-${red ? "red" : "green"}`, jobId: job.jobId, workItemId, deviceId: "zbook", baseRevision: BASE_REVISION, candidateRevision: REVISION, changedPaths: ["src/a.ts"], affectedSymbols: [], patchDigest: ARTIFACT, artifactDigest: ARTIFACT, artifactRef: `sha256:${ARTIFACT}`, ...(red ? { tddPhase: "red" as const, tddEvidenceDigest: "e".repeat(64) } : {}), evidenceDigest: "c".repeat(64), rollback: { kind: "git-base", reference: BASE_REVISION } }, NOW); },
        async verify({ plan, job }) { return plan.requiredChecks.map((check) => ({ check, verifierId: "verifier:mac", sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, status: "passed" as const, recordedAt: NOW.toISOString(), criterionId: job.definitionOfDone[0]!.id })); },
        async acceptanceEvidence({ job, plan }) { return job.definitionOfDone.map((criterion) => ({ id: `a:${criterion.id}`, criterionId: criterion.id, kind: "acceptance", issuer: "verifier:mac", verified: true, sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, recordedAt: NOW.toISOString() })); },
        async releaseState() { return { connected: true, taskScopeId: "issue:999", taskAuthorization: authorization, protectedConditions: [], classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true }, pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null, now: NOW }; },
        async executeRelease() { releases += 1; },
      },
    });
    const result = await host.run({ goalId: "g", goal: { title: "Implement safe change", successCriteria: ["verified"], constraints: [] }, context: [] });
    assert.equal(result.stopReason, "approval_required");
    assert.equal(releases, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resident Goal path does not synthesize physical iPhone criterion evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-self-development-iphone-"));
  try {
    const host = new ResidentDevelopmentGoalHost({
      jobs: new JsonFileDevelopmentJobStore(join(root, "jobs.json")), changeSets: new JsonFileDevelopmentChangeSetStore(join(root, "changes.json")),
      planning: { requirementIds: ["CORE-014"], baseRevision: BASE_REVISION, taskScopeId: "issue:681", maxRisk: "medium", targetFiles: ["ios/App.swift"], contextDigest: "d".repeat(64) },
      stages: {
        builderId: "builder:zbook",
        async build({ job, workItemId }) { const red = workItemId.endsWith(":test"); return createDevelopmentChangeSet({ changeSetId: `c-${red ? "red" : "green"}`, jobId: job.jobId, workItemId, deviceId: "zbook", baseRevision: BASE_REVISION, candidateRevision: REVISION, changedPaths: ["ios/App.swift"], affectedSymbols: [], patchDigest: ARTIFACT, artifactDigest: ARTIFACT, artifactRef: `sha256:${ARTIFACT}`, ...(red ? { tddPhase: "red" as const, tddEvidenceDigest: "e".repeat(64) } : {}), evidenceDigest: "c".repeat(64), rollback: { kind: "git-base", reference: BASE_REVISION } }, NOW); },
        async verify({ plan }) { return plan.requiredChecks.filter((check) => check !== "physical-iphone").map((check) => ({ check, verifierId: "verifier:mac", sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, status: "passed" as const, recordedAt: NOW.toISOString() })); },
        async releaseState() { throw new Error("release must not be reached"); },
      },
    });
    const result = await host.run({ goalId: "g", goal: { title: "Implement iPhone change", successCriteria: ["signed physical iPhone result"], constraints: [] }, context: [] });
    assert.equal(result.goalEvaluation?.achieved, false);
    assert.ok(result.goalEvaluation?.blockers.includes("missing_evidence:physical-iphone"));
    const job = (await new JsonFileDevelopmentJobStore(join(root, "jobs.json")).getByGoal("g"))[0]!;
    assert.equal(job.evidence.some((item) => item.criterionId === "criterion-1" && item.verified), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resident Goal path reconciles an interruption between Change Set and Job checkpoints", async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-self-development-crash-"));
  try {
    const realJobs = new JsonFileDevelopmentJobStore(join(root, "jobs.json"));
    const changes = new JsonFileDevelopmentChangeSetStore(join(root, "changes.json"));
    let crashed = false;
    const faultingJobs = {
      get: realJobs.get.bind(realJobs), getByGoal: realJobs.getByGoal.bind(realJobs), list: realJobs.list.bind(realJobs),
      async put(job: Parameters<typeof realJobs.put>[0], now?: Date) {
        if (!crashed && job.phase === "READY_TO_PUBLISH") { crashed = true; throw new Error("injected checkpoint interruption"); }
        await realJobs.put(job, now);
      },
    };
    let builds = 0;
    let verifies = 0;
    const authorization = createTaskCompletionAuthorization("Issue #681を完成させて", { now: NOW });
    assert.ok(authorization);
    const stages: ResidentDevelopmentStages = {
      async build({ job, workItemId }) { builds += 1; const red = workItemId.endsWith(":test"); return createDevelopmentChangeSet({ changeSetId: `crash-change-${red ? "red" : "green"}`, jobId: job.jobId, workItemId, deviceId: "builder", baseRevision: BASE_REVISION, candidateRevision: REVISION, changedPaths: ["src/a.ts"], affectedSymbols: [], patchDigest: ARTIFACT, artifactDigest: ARTIFACT, artifactRef: `sha256:${ARTIFACT}`, ...(red ? { tddPhase: "red" as const, tddEvidenceDigest: "e".repeat(64) } : {}), evidenceDigest: "c".repeat(64), rollback: { kind: "git-base", reference: BASE_REVISION } }, NOW); },
      async verify({ plan }) { verifies += 1; return plan.requiredChecks.map((check) => ({ check, verifierId: "verifier", sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, status: "passed" as const, recordedAt: NOW.toISOString() })); },
      async acceptanceEvidence({ job, plan }) { return job.definitionOfDone.map((criterion) => ({ id: `accept:${criterion.id}`, criterionId: criterion.id, kind: "acceptance", issuer: "verifier", verified: true, sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, recordedAt: NOW.toISOString() })); },
      async releaseState({ job }) { return { connected: false, taskScopeId: job.approvalScope.taskScopeId, taskAuthorization: authorization, protectedConditions: [], classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true }, pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null, now: NOW }; },
    };
    const planning = { requirementIds: ["CORE-014"], baseRevision: BASE_REVISION, taskScopeId: "issue:681", maxRisk: "medium" as const, targetFiles: ["src/a.ts"], contextDigest: "d".repeat(64) };
    await assert.rejects(() => new ResidentDevelopmentGoalHost({ jobs: faultingJobs, changeSets: changes, stages, planning }).run({ goalId: "g", goal: { title: "Implement", successCriteria: ["verified"], constraints: [] }, context: [] }), /checkpoint interruption/);
    const resumed = await new ResidentDevelopmentGoalHost({ jobs: new JsonFileDevelopmentJobStore(join(root, "jobs.json")), changeSets: new JsonFileDevelopmentChangeSetStore(join(root, "changes.json")), stages, planning }).run({ goalId: "g", goal: { title: "Implement", successCriteria: ["verified"], constraints: [] }, context: [] });
    assert.equal(resumed.goalEvaluation?.remainingGaps.some((gap) => gap.includes("publication")), true);
    assert.equal(builds, 2);
    assert.equal(verifies, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("repeated verification failure records distinct attempts and identical rejected output blocks without retry loop", async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-self-development-recovery-"));
  try {
    const jobsPath = join(root, "jobs.json");
    const changes = new JsonFileDevelopmentChangeSetStore(join(root, "changes.json"));
    let implementationBuilds = 0;
    let redBuilds = 0;
    let verifications = 0;
    const stages: ResidentDevelopmentStages = {
      async build({ job, workItemId }) {
        const red = workItemId.endsWith(":test");
        if (red) redBuilds++;
        else implementationBuilds++;
        const ordinal = red ? 0 : Math.min(implementationBuilds, 2);
        const revision = red ? "f".repeat(40) : String(ordinal).repeat(40);
        const digest = red ? "f".repeat(64) : String(ordinal).repeat(64);
        return createDevelopmentChangeSet({
          changeSetId: red ? "recovery:red" : "recovery:green:" + implementationBuilds,
          jobId: job.jobId, workItemId, deviceId: "builder:zbook",
          baseRevision: BASE_REVISION, candidateRevision: revision,
          changedPaths: ["src/recovery.ts"], affectedSymbols: [],
          patchDigest: digest, artifactDigest: digest, artifactRef: "sha256:" + digest,
          ...(red ? { tddPhase: "red" as const, tddEvidenceDigest: "e".repeat(64) } : {}),
          evidenceDigest: "c".repeat(64),
          rollback: { kind: "git-base" as const, reference: BASE_REVISION },
        }, NOW);
      },
      async verify({ plan }) {
        verifications++;
        return plan.requiredChecks.map((check) => ({
          check, verifierId: "verifier:separate",
          sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest,
          status: check === "unit" ? "failed" as const : "passed" as const,
          recordedAt: NOW.toISOString(),
        }));
      },
      async releaseState() { throw new Error("rejected candidate must never reach release"); },
    };
    const runtime = () => new ResidentDevelopmentGoalHost({
      jobs: new JsonFileDevelopmentJobStore(jobsPath), changeSets: changes, stages,
      planning: { requirementIds: ["CORE-014"], baseRevision: BASE_REVISION,
        taskScopeId: "issue:1219", maxRisk: "low", targetFiles: ["src/recovery.ts"], contextDigest: "d".repeat(64) },
    });
    const input = { goalId: "g-retry", goal: {
      title: "Implement bounded recovery", successCriteria: ["independently passing tests"], constraints: [],
    }, context: [] };
    const first = await runtime().run(input);
    assert.ok(first.goalEvaluation?.blockers.includes("check_not_passed:unit"));
    const second = await runtime().run(input);
    assert.ok(second.goalEvaluation?.blockers.includes("check_not_passed:unit"));
    const before = (await new JsonFileDevelopmentJobStore(jobsPath).getByGoal("g-retry"))[0]!;
    assert.equal(before.phase, "RECOVERING");
    assert.equal(before.attempts.length, 2);
    assert.equal(before.failureSignatures.length, 1);
    assert.equal(before.history.filter((item) => item.failureSignature).length, 2);
    assert.equal(new Set(before.history.filter((item) => item.failureSignature).map((item) => item.transitionId)).size, 2);
    assert.equal((await changes.list()).filter((item) => item.status === "REJECTED").length, 2);
    const third = await runtime().run(input);
    assert.ok(third.goalEvaluation?.blockers.includes("equivalent_failed_candidate"));
    const after = (await new JsonFileDevelopmentJobStore(jobsPath).getByGoal("g-retry"))[0]!;
    assert.equal(after.phase, "BLOCKED");
    assert.equal(after.attempts.length, 2);
    assert.equal((await changes.list()).filter((item) => item.status === "REJECTED").length, 3);
    assert.equal(verifications, 2);
    assert.equal(redBuilds, 1);
    assert.equal(implementationBuilds, 3);
    await runtime().run(input);
    assert.equal(implementationBuilds, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resident executor gives each retry a distinct Builder, Change Set and verifier identity", () => {
  const source = readFileSync("scripts/jarvis-goal-executor.ts", "utf8");
  assert.ok(source.includes("change-set:" + "${tddPhase}" + ":attempt:" + "${job.attempts.length + 1}"));
  assert.ok(source.includes("build:" + "${workItem.id}" + ":attempt:" + "${job.attempts.length + 1}"));
  assert.ok(source.includes("verify:" + "${changeSet.changeSetId}"));
});

for (const status of ["LOCAL", "READY_TO_PUBLISH"] as const) {
 for (const authorized of [false, true]) {
  test(`resident recovery resumes a persisted ${status} replacement before the Job checkpoint (authorized=${authorized})`, async () => {
    const root = mkdtempSync(join(tmpdir(), "goriq-replacement-checkpoint-"));
    try {
      const planning = { requirementIds: ["CORE-014"], baseRevision: BASE_REVISION,
        taskScopeId: "issue:1219", maxRisk: "low" as const, targetFiles: ["src/recovery.ts"], contextDigest: "b".repeat(64) };
      const goal = { title: "Implement bounded recovery", successCriteria: ["independently verified repair"], constraints: ["no external effects"] };
      let job = new DevelopmentOrchestrator().plan({ jobId: "checkpoint-job", goalId: "checkpoint-goal",
        objective: goal.title, acceptanceCriteria: goal.successCriteria, ...planning }).job;
      const controller = new DevelopmentJobStateController();
      job = controller.apply(job, { transitionId: "planning", actor: "state-controller", to: "PLANNING", reason: "fixture plan" });
      job = controller.apply(job, { transitionId: "implementing", actor: "state-controller", to: "IMPLEMENTING", reason: "fixture implementation" });
      job = controller.apply(job, { transitionId: "recovering", actor: "state-controller", to: "RECOVERING", reason: "prior candidate failed",
        failure: { signature: "f".repeat(64), strategyId: "failed-strategy", hypothesis: "change strategy after failed checks" },
        evidence: ["lint", "typecheck", "unit", "integration", "security", "build"].map((check) => ({
          id: `prior-failed:${check}`, criterionId: "repository-verification", kind: `development-check:${check}`,
          issuer: "fixture-separate-verifier", verified: false, sourceRevision: "1".repeat(40), artifactDigest: "2".repeat(64), recordedAt: new Date().toISOString(),
        })) });
      const jobsPath = join(root, "jobs.json"), changesPath = join(root, "changes.json");
      await new JsonFileDevelopmentJobStore(jobsPath).put(job);
      const implementation = job.workItems.find((item) => item.id.endsWith(":implement"))!;
      const candidate = { ...createDevelopmentChangeSet({ changeSetId: "replacement-candidate", jobId: job.jobId,
        workItemId: implementation.id, deviceId: "fixture-builder", baseRevision: BASE_REVISION,
        candidateRevision: REVISION, changedPaths: ["src/recovery.ts"], affectedSymbols: [], patchDigest: "d".repeat(64),
        artifactDigest: ARTIFACT, artifactRef: `sha256:${ARTIFACT}`, evidenceDigest: "0".repeat(64),
        rollback: { kind: "git-base", reference: BASE_REVISION } }), status };
      await new JsonFileDevelopmentChangeSetStore(changesPath).put(candidate);
      await new JsonFileDevelopmentChangeSetStore(changesPath).put({ ...candidate, changeSetId: "prior-failed-candidate",
        status: "REJECTED", candidateRevision: "1".repeat(40), artifactDigest: "2".repeat(64), artifactRef: `sha256:${"2".repeat(64)}`, patchDigest: "3".repeat(64) });
      const authorization = authorized ? createTaskCompletionAuthorization("Issue #1219を完成させて", { now: new Date() })! : undefined;
      let builds = 0, verifications = 0;
      const runtime = () => new ResidentDevelopmentGoalHost({ jobs: new JsonFileDevelopmentJobStore(jobsPath),
        changeSets: new JsonFileDevelopmentChangeSetStore(changesPath), planning, stages: {
          async build() { builds += 1; throw new Error("persisted replacement must not rebuild"); },
          async verify({ plan }) { verifications += 1; return plan.requiredChecks.map((check) => ({ check,
            verifierId: "fixture-separate-verifier", sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest,
            status: "passed" as const, recordedAt: new Date().toISOString() })); },
          async releaseState() { return { connected: false, taskScopeId: "issue:1219", taskAuthorization: authorization, protectedConditions: [],
            classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true }, pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null }; },
        } });
      const input = { goalId: job.goalId, goal, context: [] };
      await runtime().run(input);
      const resumed = (await new JsonFileDevelopmentJobStore(jobsPath).get(job.jobId))!;
      assert.equal(builds, 0);
      assert.equal(verifications, 1);
      assert.ok(resumed.history.some((entry) => entry.to === "READY_TO_PUBLISH"));
      assert.equal(resumed.phase, authorized ? "READY_TO_PUBLISH" : "HUMAN_GATE");
      assert.deepEqual(resumed.failureSignatures, ["f".repeat(64)]);
      assert.equal(resumed.attempts.length, 1);
      assert.ok(resumed.evidence.some((item) => item.verified && item.artifactDigest === candidate.artifactDigest));
      assert.equal(resumed.evidence.filter((item) => item.sourceRevision === "1".repeat(40)).length, 6, "old failed evidence is retained");
      await runtime().run(input);
      assert.equal(builds, 0);
      assert.equal(verifications, 1, "restart reuses the exact bound verification");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
 }
}
