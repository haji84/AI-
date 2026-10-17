import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { ResidentDevelopmentGoalHost, type ResidentDevelopmentStages } from "../src/orchestrator/resident-development-goal-host.ts";

test("missing verifier receipts preserve candidate and resume without a second Builder call", async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-verifier-wait-"));
  try {
    const jobs = new JsonFileDevelopmentJobStore(join(root, "jobs.json"));
    const changes = new JsonFileDevelopmentChangeSetStore(join(root, "changes.json"));
    const base = "a".repeat(40), artifact = "b".repeat(64);
    let builds = 0, verificationCalls = 0, fullVerifierReady = false;
    const stages: ResidentDevelopmentStages = {
      async build({job,workItemId}) {
        builds++;
        const red = workItemId.endsWith(":test");
        return createDevelopmentChangeSet({
          changeSetId: `${job.jobId}:${red ? "red" : "green"}`,
          jobId: job.jobId, workItemId, deviceId: "local-ollama-builder",
          baseRevision: base, changedPaths: [red ? "tests/test.py" : "tests/impl.py"],
          affectedSymbols: [], patchDigest: artifact, artifactDigest: artifact,
          artifactRef: `sha256:${artifact}`,
          ...(red ? { tddPhase: "red" as const, tddEvidenceDigest: "c".repeat(64) } : {}),
          evidenceDigest: "d".repeat(64), rollback: { kind: "git-base" as const, reference: base },
        });
      },
      async verify({plan}) {
        verificationCalls++;
        return (fullVerifierReady ? plan.requiredChecks : ["unit" as const]).map(check => ({
          check, verifierId: "separate-real-verifier", sourceRevision: plan.sourceRevision,
          artifactDigest: plan.artifactDigest, status: "passed" as const,
          recordedAt: new Date().toISOString(),
        }));
      },
      async releaseState() {
        return { connected: false, taskScopeId: "goal:wait", protectedConditions: [],
          classifications: null, pullRequest: null, mainCi: null,
          deployment: null, postDeploymentEvidence: null };
      },
    };
    const makeHost = () => new ResidentDevelopmentGoalHost({
      jobs: new JsonFileDevelopmentJobStore(join(root, "jobs.json")),
      changeSets: new JsonFileDevelopmentChangeSetStore(join(root, "changes.json")),
      stages, planning: { requirementIds: ["CORE-014"], baseRevision: base,
        taskScopeId: "goal:wait", maxRisk: "low",
        targetFiles: ["tests/impl.py"], contextDigest: "e".repeat(64) },
    });
    const request = {goalId:"goal:wait",goal:{title:"Implement bounded local code",
      description:"Implement verified bounded local code",successCriteria:["verified code"],constraints:[]},context:[]};
    const first = await makeHost().run(request);
    assert.equal(first.stopReason, "cycle_budget_exhausted");
    assert.match(first.goalEvaluation!.remainingGaps[0]!, /^independent_verifier_pending:/);
    assert.equal(builds, 2);
    assert.equal((await changes.list()).filter(c=>c.status==="LOCAL").length, 1);
    assert.equal((await jobs.getByGoal("goal:wait"))[0]?.phase, "VERIFYING");
    const second = await makeHost().run(request);
    assert.equal(second.stopReason, "cycle_budget_exhausted");
    assert.equal(builds, 2);
    assert.equal(verificationCalls, 2);
    fullVerifierReady = true;
    const third = await makeHost().run(request);
    assert.equal(third.goalEvaluation?.achieved, false);
    assert.equal(builds, 2);
    assert.equal((await changes.list()).filter(c=>c.status==="READY_TO_PUBLISH").length, 1);
    assert.equal((await jobs.getByGoal("goal:wait"))[0]?.phase, "READY_TO_PUBLISH");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
