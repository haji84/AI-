import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { createDevelopmentJob } from "../src/orchestrator/development-job.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { GoalControllerExecutionBridge } from "../src/orchestrator/goal-controller-execution-bridge.ts";
import type { GoalControllerDecision } from "../src/orchestrator/goal-controller-runtime.ts";
import { ResidentDevelopmentGoalHost, type ResidentDevelopmentStages } from "../src/orchestrator/resident-development-goal-host.ts";

const BASE = "a".repeat(40);
const request = { goalId: "goal-repair-continuation", goal: {
  title: "Repair the existing implementation", successCriteria: ["verified usable code"], constraints: [],
}, context: [] };
const decision: GoalControllerDecision = {
  resolution: { kind: "EXISTING_GOAL", intent: "COMMAND", reason: "accepted-owner-goal",
    intake: { id: "resume", source: "github", text: "Continue accepted work", sourceContext: {},
      idempotencyKey: "resume", goalHint: request.goalId } },
  action: "CONTINUE_GOAL", goalId: request.goalId,
};

async function fixture(t: TestContext, mode: "repair" | "equivalent" | "always-fail" | "stale" | "inconclusive" | "self-verified" = "repair") {
  const root = mkdtempSync(join(tmpdir(), "goriq-verification-continuation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const jobsFile = join(root, "jobs.json"), changesFile = join(root, "changes.json");
  const jobs = () => new JsonFileDevelopmentJobStore(jobsFile);
  const changes = () => new JsonFileDevelopmentChangeSetStore(changesFile);
  await jobs().put(createDevelopmentJob({ jobId: "repair-job", goalId: request.goalId,
    requirementIds: ["CORE-014"], acceptanceCriteria: ["verified usable code"],
    definitionOfDone: [{ id: "criterion-1", description: "verified usable code", required: true }],
    baseRevision: BASE, approvalScope: { taskScopeId: "issue:1219", maxRisk: "low" },
    workItems: [{ id: "repair-job:implement", objective: "Repair bounded code", dependsOn: [], requiredCapabilities: ["code-builder"] }],
  }));
  const builds: Array<{ phase: string; failures: string[]; hypotheses: string[] }> = [];
  let releases = 0;
  const stages: ResidentDevelopmentStages = {
    deferMissingVerification: true,
    async build({ job, workItemId }) {
      builds.push({ phase: job.phase, failures: [...job.failureSignatures], hypotheses: job.attempts.map(a => a.hypothesis) });
      const bytes = mode === "equivalent" ? "unchanged rejected implementation" : `candidate-${builds.length}`;
      const hash = createHash("sha256").update(bytes).digest("hex");
      return createDevelopmentChangeSet({ changeSetId: `repair-candidate-${builds.length}`, jobId: job.jobId,
        workItemId, deviceId: "test-builder", baseRevision: BASE, candidateRevision: hash,
        changedPaths: ["src/repair.ts"], affectedSymbols: [], patchDigest: hash, artifactDigest: hash,
        evidenceDigest: hash, rollback: { kind: "git-base", reference: BASE } });
    },
    async verify({ plan }) {
      return plan.requiredChecks.map(check => ({ check,
        verifierId: mode === "self-verified" ? "test-builder" : "test-independent-verifier",
        sourceRevision: mode === "stale" ? "f".repeat(40) : plan.sourceRevision,
        artifactDigest: plan.artifactDigest,
        status: check !== "unit" ? "passed" as const : mode === "inconclusive" ? "inconclusive" as const
          : mode === "repair" && builds.length > 1 ? "passed" as const : "failed" as const,
        recordedAt: new Date().toISOString(),
      }));
    },
    async releaseState() {
      releases++;
      return { connected: false, taskScopeId: "issue:1219", protectedConditions: [], classifications: null,
        pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null };
    },
  };
  const host = () => new ResidentDevelopmentGoalHost({ jobs: jobs(), changeSets: changes(), stages,
    planning: { requirementIds: ["CORE-014"], baseRevision: BASE, taskScopeId: "issue:1219", maxRisk: "low",
      targetFiles: ["src/repair.ts"], contextDigest: "e".repeat(64) } });
  const bridge = () => new GoalControllerExecutionBridge({ async run() { return host().run(request); } });
  return { jobs, changes, builds, stages, host, bridge, releases: () => releases };
}

test("the canonical bridge repairs failed verification without a second owner instruction, then preserves the release Human Gate", async t => {
  const f = await fixture(t);
  const result = await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 4 });
  assert.equal(f.builds.length, 2, "the first verification failure must reach the next bounded strategy");
  assert.equal(result.reason, "human_gate", "passing code cannot grant missing publication authority");
  assert.equal(result.report?.goalEvaluation?.achieved, false);
  assert.equal(f.builds[1]!.phase, "IMPLEMENTING");
  assert.equal(f.builds[1]!.failures.length, 1);
  assert.match(f.builds[1]!.hypotheses[0]!, /check_not_passed:unit/);
  assert.equal(f.releases(), 1);
  assert.deepEqual((await f.changes().list()).map(c => [c.changeSetId, c.status]),
    [["repair-candidate-1", "REJECTED"], ["repair-candidate-2", "READY_TO_PUBLISH"]]);
  const job = (await f.jobs().get("repair-job"))!;
  assert.equal(job.phase, "HUMAN_GATE");
  assert.equal(job.attempts.length, 1);
  assert.ok(job.evidence.some(e => !e.verified && e.kind === "development-check:unit"));
  assert.ok(job.evidence.some(e => e.verified && e.kind === "development-check:unit"));
});

test("an equivalent rejected candidate stops automatic continuation and is preserved", async t => {
  const f = await fixture(t, "equivalent");
  const result = await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 4 });
  assert.equal(f.builds.length, 2);
  assert.equal(result.reason, "blocked");
  assert.deepEqual(result.report?.goalEvaluation?.blockers, ["equivalent_failed_candidate"]);
  assert.equal(f.releases(), 0);
  assert.equal((await f.changes().list()).filter(c => c.status === "REJECTED").length, 2);
  await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 4 });
  assert.equal(f.builds.length, 2, "a fresh host must honor the persisted stop");
});

test("recovery strategy limits survive a new host and reject an unbounded series of different bad candidates", async t => {
  const f = await fixture(t, "always-fail");
  const bounded = await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 2 });
  assert.equal(bounded.reason, "goal_continuation_budget_exhausted");
  assert.equal(f.builds.length, 2);
  assert.equal((await f.jobs().get("repair-job"))?.phase, "RECOVERING");
  const resumed = await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 12 });
  assert.equal(resumed.reason, "blocked");
  assert.equal(f.builds.length, 5, "the existing recovery policy permits two strategy pivots, not a fresh budget per process");
  assert.deepEqual(resumed.report?.goalEvaluation?.blockers, ["verification_recovery_exhausted"]);
  assert.equal((await f.jobs().get("repair-job"))?.attempts.length, 5);
  await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 12 });
  assert.equal(f.builds.length, 5);
  assert.equal(f.releases(), 0);
});

for (const mode of ["stale", "inconclusive", "self-verified"] as const) {
  test(`${mode} verification is a stop, not permission to keep coding`, async t => {
    const f = await fixture(t, mode);
    const result = await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 4 });
    assert.equal(result.reason, "blocked");
    assert.equal(f.builds.length, 1);
    assert.equal(f.releases(), 0);
    assert.equal(result.report?.goalEvaluation?.achieved, false);
    assert.equal((await f.jobs().get("repair-job"))?.phase, "BLOCKED");
    const restarted = await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 4 });
    assert.equal(restarted.reason, "blocked");
    assert.equal(f.builds.length, 1, "invalid evidence must not authorize a new Builder after restart");
  });
}

for (const checkpoint of ["job", "candidate"] as const) {
  test(`interrupted ${checkpoint} failure checkpoint does not grant an unrecorded repair`, async t => {
    const f = await fixture(t, "always-fail");
    let interrupted = false;
    const jobs = f.jobs(), changes = f.changes();
    const saveJob = jobs.put.bind(jobs), saveCandidate = changes.put.bind(changes);
    jobs.put = async job => {
      if (checkpoint === "job" && job.attempts.length && !interrupted) {
        interrupted = true; throw Error("simulated checkpoint interruption");
      }
      return saveJob(job);
    };
    changes.put = async change => {
      if (checkpoint === "candidate" && change.status === "REJECTED" && !interrupted) {
        interrupted = true; throw Error("simulated checkpoint interruption");
      }
      return saveCandidate(change);
    };
    const crashing = new ResidentDevelopmentGoalHost({ jobs, changeSets: changes, stages: f.stages,
      planning: { requirementIds: ["CORE-014"], baseRevision: BASE, taskScopeId: "issue:1219", maxRisk: "low",
        targetFiles: ["src/repair.ts"], contextDigest: "e".repeat(64) } });
    await assert.rejects(crashing.run(request), /simulated checkpoint interruption/);
    assert.equal(f.builds.length, 1);
    if (checkpoint === "job") {
      await f.host().run(request);
      assert.equal(f.builds.length, 1, "an uncommitted diagnosis must re-verify the existing candidate");
      assert.equal((await f.jobs().get("repair-job"))?.attempts.length, 1);
    } else {
      assert.equal((await f.jobs().get("repair-job"))?.attempts.length, 1,
        "the diagnosis must commit before the failed candidate status");
    }
    const resumed = await f.bridge().executeUntilGoalTerminal(decision, { maxRuns: 12 });
    assert.equal(resumed.reason, "blocked");
    assert.equal(f.builds.length, 5, "checkpoint interruption must not reset the persisted failure budget");
  });
}
