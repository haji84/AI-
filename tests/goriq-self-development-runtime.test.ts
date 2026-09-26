import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  type ResidentDevelopmentReleaseState,
} from "../src/orchestrator/resident-development-goal-host.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const REVISION = "a".repeat(40);
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
      pullRequest: null,
      mainCi: null,
      deployment: null,
      postDeploymentEvidence: null,
      now: NOW,
    };

    const stages = {
      async build(input: { job: { jobId: string; goalId: string }; workItemId: string }) {
        builds += 1;
        return createDevelopmentChangeSet({
          changeSetId: `change-${input.job.jobId}`,
          jobId: input.job.jobId,
          workItemId: input.workItemId,
          deviceId: "zbook-1",
          baseRevision: REVISION,
          changedPaths: ["src/orchestrator/example.ts"],
          affectedSymbols: ["example"],
          patchDigest: ARTIFACT,
          evidenceDigest: "c".repeat(64),
          rollback: { kind: "git-base" as const, reference: REVISION },
        }, NOW);
      },
      async verify(input: { plan: { requiredChecks: string[]; sourceRevision: string; artifactDigest: string } }) {
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
      async releaseState() { return { ...releaseState, connected }; },
      async executeRelease(action: string) {
        releaseEffects.push(action);
        if (action === "OPEN_PR") {
          releaseState = {
            ...releaseState,
            pullRequest: {
              url: "https://github.example/pr/681",
              headRevision: REVISION,
              baseBranch: "main",
              draft: false,
              autoMergeEnabled: true,
              mergedRevision: REVISION,
              reviewerPassed: true,
              unresolvedReviewThreads: 0,
            },
            mainCi: { revision: REVISION, passed: true },
          };
        } else if (action === "DEPLOY_PRODUCTION") {
          releaseState = {
            ...releaseState,
            deployment: { revision: REVISION, artifactDigest: ARTIFACT, environment: "production" as const },
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
        baseRevision: REVISION,
        taskScopeId: "issue:681",
        maxRisk: "medium",
        targetFiles: ["src/orchestrator/example.ts"],
        contextDigest: "d".repeat(64),
      },
    });
    const first = new CompassGoalExecutionAdapter(compassPath, {}, {}, { runtime: runtime() });
    const offline = await first.run(active.goalId);
    assert.equal(offline.stopReason, "cycle_budget_exhausted");
    assert.equal(builds, 1);
    assert.equal(verifications, 1);
    assert.deepEqual(releaseEffects, []);

    connected = true;
    const restarted = new CompassGoalExecutionAdapter(compassPath, {}, {}, { runtime: runtime() });
    let final = await restarted.run(active.goalId);
    final = await restarted.run(active.goalId);
    final = await restarted.run(active.goalId);
    assert.equal(final.stopReason, "goal_complete");
    assert.equal(final.goalEvaluation?.achieved, true);
    assert.equal(builds, 1);
    assert.equal(verifications, 1);
    assert.deepEqual(releaseEffects, ["OPEN_PR", "DEPLOY_PRODUCTION"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
