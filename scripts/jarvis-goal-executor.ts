import { CompassStore } from "../src/compass/store.ts";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CompassGoalExecutionAdapter, type DevelopmentRuntimeOptions } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { CompassGoalBridgeEventStore } from "../src/orchestrator/compass-goal-bridge-event-store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { GoalControllerExecutionBridge } from "../src/orchestrator/goal-controller-execution-bridge.ts";
import { createGoalBridgeEvent } from "../src/orchestrator/goal-bridge-events.ts";
import type { GoalControllerDecision } from "../src/orchestrator/goal-controller-runtime.ts";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { ResidentDevelopmentGoalHost } from "../src/orchestrator/resident-development-goal-host.ts";
import { createRuntimeBuilderRouter } from "../src/orchestrator/runtime-builder-capability.ts";
import { createRuntimeDevelopmentVerifier } from "../src/orchestrator/runtime-development-verifier.ts";
import { HttpDevelopmentReleaseCapability } from "../src/orchestrator/http-development-release-capability.ts";
import { normalizeTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";
import { buildRepositoryDevelopmentContext } from "../src/orchestrator/repository-development-context.ts";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodeContext(value: string | undefined): unknown[] {
  if (!value) return [];
  if (value.length > 64_000) throw new Error("Goal execution context is too large");
  const decoded = Buffer.from(value, "base64").toString("utf8");
  const parsed: unknown = JSON.parse(decoded);
  if (!Array.isArray(parsed)) throw new Error("Goal execution context must be an array");
  return parsed;
}

function executorDecision(goalId: string): GoalControllerDecision {
  const key = `executor-${goalId}`;
  return {
    resolution: {
      kind: "EXISTING_GOAL",
      intent: "COMMAND",
      intake: {
        id: key,
        source: "event",
        text: "Continue persisted autonomous Goal execution",
        sourceContext: {},
        idempotencyKey: key,
        goalHint: goalId,
      },
      reason: "broker_scheduled_goal_execution",
    },
    action: "CONTINUE_GOAL",
    goalId,
    nextAction: null,
    remainingCriteria: [],
  };
}

function configuredDevelopmentRuntime(compassPath: string, context: unknown[]): DevelopmentRuntimeOptions | undefined {
  if (process.env.GORIQ_SELF_DEVELOPMENT_RUNTIME !== "1") return undefined;
  const contextText = JSON.stringify(context);
  const configuredFiles = (process.env.GORIQ_SELF_DEVELOPMENT_TARGET_FILES ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const inferredFiles = contextText.match(/(?:src|tests|scripts|docs)\/[A-Za-z0-9_./-]+/g) ?? [];
  const targetFiles = [...new Set([...configuredFiles, ...inferredFiles])];
  if (!targetFiles.length) throw new Error("GORIQ self-development target files are required");
  const taskScopeId = process.env.GORIQ_SELF_DEVELOPMENT_TASK_SCOPE_ID?.trim();
  if (!taskScopeId) throw new Error("GORIQ self-development task scope is required");
  const authorization = process.env.GORIQ_SELF_DEVELOPMENT_TASK_AUTHORIZATION_JSON
    ? normalizeTaskCompletionAuthorization(JSON.parse(process.env.GORIQ_SELF_DEVELOPMENT_TASK_AUTHORIZATION_JSON))
    : undefined;
  const baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  const repositoryRoot = resolve(process.cwd());
  const tracked = execFileSync("git", ["ls-files"], { cwd: repositoryRoot, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const relatedTests = tracked.filter((path) => path.startsWith("tests/") && targetFiles.some((target) => path.includes(target.split("/").at(-1)?.split(".")[0] ?? "\0")));
  const candidatePaths = [...new Set([...targetFiles, ...relatedTests])].slice(0, 200);
  const entries = candidatePaths.flatMap((path) => {
    const absolute = resolve(repositoryRoot, path);
    const rel = relative(repositoryRoot, absolute);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || !existsSync(absolute)) return [];
    const content = readFileSync(absolute, "utf8");
    return [{ path: rel.replaceAll("\\", "/"), content: content.slice(0, 100_000) }];
  });
  const repositoryContext = buildRepositoryDevelopmentContext({ objective: "resident self-development", preferredFiles: targetFiles, entries, maxChars: 40_000 });
  const router = createRuntimeBuilderRouter();
  const verifier = createRuntimeDevelopmentVerifier();
  const releaseUrl = process.env.GORIQ_SELF_DEVELOPMENT_RELEASE_URL?.trim();
  const releaseToken = process.env.GORIQ_SELF_DEVELOPMENT_RELEASE_TOKEN?.trim();
  if (Boolean(releaseUrl) !== Boolean(releaseToken)) throw new Error("GORIQ release URL and token must be configured together");
  const release = releaseUrl && releaseToken ? new HttpDevelopmentReleaseCapability({ url: releaseUrl, token: releaseToken }) : undefined;
  const stateRoot = join(dirname(compassPath), "self-development");
  const host = new ResidentDevelopmentGoalHost({
    jobs: new JsonFileDevelopmentJobStore(join(stateRoot, "jobs.json")),
    changeSets: new JsonFileDevelopmentChangeSetStore(join(stateRoot, "change-sets.json")),
    planning: {
      requirementIds: ["CORE-014"],
      baseRevision,
      taskScopeId,
      maxRisk: "medium",
      targetFiles,
      contextDigest: createHash("sha256").update(contextText).digest("hex"),
    },
    stages: {
      builderId: "builder:resident",
      async build({ job, context: runtimeContext, workItemId }) {
        const workItem = job.workItems.find((item) => item.id === workItemId);
        if (!workItem) throw new Error("resident Builder Work Item is not in the durable Job");
        const tddPhase = workItem.id.endsWith(":test") ? "red" as const : "green" as const;
        const action = {
          id: `${job.jobId}:build`,
          description: workItem.objective,
          capability: "code.builder",
          risk: "low" as const,
          input: {
            goalId: job.goalId,
            attemptId: `${job.jobId}:attempt:${job.attempts.length + 1}`,
            strategyId: `${job.jobId}:strategy:${job.attempts.length + 1}`,
            objective: workItem.objective,
            files: targetFiles,
            baseRevision: job.baseRevision,
            previousFailureSignatures: job.failureSignatures,
            previousStrategyFingerprints: job.rejectedStrategyIds,
            hypothesis: job.attempts.at(-1)?.hypothesis,
            localOnly: process.env.GORIQ_SELF_DEVELOPMENT_LOCAL_ONLY === "1",
            tddPhase,
          },
        };
        const result = await router.execute(action, [...runtimeContext, { source: "repository.development-context", summary: `Selected ${repositoryContext.selectedPaths.length} repository files`, data: repositoryContext }]);
        if (!result.ok) throw new Error(result.blocker ?? result.summary);
        const envelope = (result.evidence as { changeSet?: { baseRevision?: string | null; changedPaths?: string[]; patchDigest?: string; candidateRevision?: string; artifactDigest?: string; artifactRef?: string; tddPhase?: "red" | "green"; tddEvidenceDigest?: string; builderId?: string } } | undefined)?.changeSet;
        if (!envelope || envelope.baseRevision !== job.baseRevision || !envelope.patchDigest) throw new Error("resident Builder returned incomplete Change Set evidence");
        return createDevelopmentChangeSet({
          changeSetId: `${job.jobId}:change-set:${tddPhase}`,
          jobId: job.jobId,
          workItemId,
          deviceId: envelope.builderId ?? "builder:resident",
          baseRevision: job.baseRevision,
          changedPaths: envelope.changedPaths ?? [],
          affectedSymbols: [],
          patchDigest: envelope.patchDigest,
          candidateRevision: envelope.candidateRevision,
          artifactDigest: envelope.artifactDigest,
          artifactRef: envelope.artifactRef,
          tddPhase: envelope.tddPhase,
          tddEvidenceDigest: envelope.tddEvidenceDigest,
          evidenceDigest: createHash("sha256").update(JSON.stringify(result.evidence ?? null)).digest("hex"),
          rollback: { kind: "git-base", reference: job.baseRevision },
        });
      },
      async verify({ job, changeSet, plan, goal, context: runtimeContext }) {
        const action = {
          id: `${job.jobId}:verify`,
          description: `Independently verify ${goal.title}`,
          capability: "code.builder",
          risk: "low" as const,
          input: {
            verificationContract: { kind: "repository_checks", profile: "standard", requiredChecks: plan.requiredChecks },
            candidate: { artifactRef: changeSet.artifactRef, changedPaths: changeSet.changedPaths },
            releaseBinding: { builderId: plan.builderId, sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest },
          },
        };
        const result = await verifier.verify({ goal, action, result: { actionId: action.id, ok: true, summary: "Change Set ready for verification" }, context: runtimeContext });
        if (!result.ok) return [];
        const evidence = result.evidence as { verificationEvidence?: unknown } | undefined;
        return Array.isArray(evidence?.verificationEvidence) ? evidence.verificationEvidence as never : [];
      },
      async releaseState(input) {
        if (!release) return { connected: false, taskScopeId, taskAuthorization: authorization, protectedConditions: [], classifications: null, pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null };
        const state = await release.state(input);
        return { ...state, taskScopeId, taskAuthorization: authorization };
      },
      ...(release ? { async executeRelease(action: string, input: Parameters<HttpDevelopmentReleaseCapability["execute"]>[1]) { await release.execute(action, input); } } : {}),
    },
  });
  return { runtime: host };
}

async function appendEvent(
  compassPath: string,
  input: Parameters<typeof createGoalBridgeEvent>[0],
): Promise<void> {
  const compass = new CompassStore(compassPath);
  try {
    await new CompassGoalBridgeEventStore(compass).append(createGoalBridgeEvent(input));
  } finally {
    compass.close();
  }
}

async function updateWorkRun(compassPath: string, goalId: string, phase: "RUNNING" | "COMPLETED" | "BLOCKED" | "HUMAN_GATE", reason: string | null): Promise<void> {
  const compass = new CompassStore(compassPath);
  try {
    const store = new CompassWorkRunStore(compass);
    const current = await store.getByGoal(goalId);
    if (!current) throw new Error("Accepted Goal has no durable Work Run");
    await store.put({ ...current, phase, blockers: phase === "BLOCKED" ? [reason ?? "execution_failed"] : [], nextAction: phase === "COMPLETED" ? null : reason, updatedAt: new Date().toISOString() });
  } finally {
    compass.close();
  }
}

async function main(): Promise<void> {
  const goalId = requiredEnv("JARVIS_GOAL_EXECUTION_GOAL_ID");
  const compassPath = requiredEnv("JARVIS_GOAL_EXECUTION_COMPASS_PATH");
  const context = decodeContext(process.env.JARVIS_GOAL_EXECUTION_CONTEXT_B64);
  const decision = executorDecision(goalId);
  try {
    await updateWorkRun(compassPath, goalId, "RUNNING", "Execute accepted Goal");
    const developmentRuntime = configuredDevelopmentRuntime(compassPath, context);
    const adapter = developmentRuntime
      ? new CompassGoalExecutionAdapter(compassPath, {}, {}, developmentRuntime)
      : new CompassGoalExecutionAdapter(compassPath);
    const bridge = new GoalControllerExecutionBridge(adapter);
    const result = await bridge.executeUntilGoalTerminal(decision, { maxRuns: 12, context });
    const report = result.report;
    const type = result.reason === "goal_complete"
      ? "GOAL_COMPLETED"
      : result.reason === "human_gate"
        ? "HUMAN_REQUIRED"
        : result.reason === "blocked" || result.reason === "retry_exhausted"
          ? "GOAL_BLOCKED"
          : "IMPORTANT_UPDATE";
    const phase = result.reason === "goal_complete" ? "COMPLETED" : result.reason === "human_gate" ? "HUMAN_GATE" : result.reason === "publication_wait" ? "RUNNING" : "BLOCKED";
    await updateWorkRun(compassPath, goalId, phase, result.reason ?? report?.stopReason ?? "goal_execution_incomplete");
    await appendEvent(compassPath, {
      goalId,
      type,
      summary: result.reason ?? report?.stopReason ?? "goal_execution_updated",
      evidenceRefs: [],
    });
    if (result.reason && result.reason !== "goal_complete") {
      console.error("[goriq-goal-executor]", goalId, result.reason);
    }
  } catch (error) {
    try {
      await updateWorkRun(compassPath, goalId, "BLOCKED", error instanceof Error ? error.message : "execution_failed");
      await appendEvent(compassPath, {
        goalId,
        type: "GOAL_BLOCKED",
        summary: "execution_failed",
        evidenceRefs: [],
      });
    } catch {
      // The original execution failure remains authoritative.
    }
    console.error("[goriq-goal-executor]", goalId, error instanceof Error ? error.message : "execution_failed");
    process.exitCode = 1;
  }
}

await main();
