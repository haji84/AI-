import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { HttpWorkerBuilderCapability } from "../src/gai/http-worker-builder-capability.ts";
import { evaluateRecovery } from "../src/orchestrator/recovery-policy.ts";
import { evaluateGoalFromWorkState } from "../src/orchestrator/goal-evaluator.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

const execFileAsync = promisify(execFile);
const endpoint = process.env.CODE_BUILDER_URL?.trim() || "http://127.0.0.1:8796";
const token = process.env.CODE_BUILDER_TOKEN?.trim() || "";
const fixture = "tests/fixtures/autonomous-builder-e2e.txt";
const evidencePath = resolve(process.cwd(), ".gai-results", "real-builder-e2e.json");

if (!token) throw new Error("CODE_BUILDER_TOKEN is required");

async function git(args: string[]) {
  return execFileAsync("git", args, { cwd: process.cwd(), windowsHide: true });
}

async function fixtureValue() {
  return (await readFile(resolve(process.cwd(), fixture), "utf8")).trim();
}

async function changedFiles(): Promise<string[]> {
  const { stdout } = await git(["status", "--porcelain"]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
}

function assertBoundedChanges(files: string[]) {
  const unexpected = files.filter((path) => path !== fixture && path !== ".gai-results/" && !path.startsWith(".gai-results/"));
  if (unexpected.length) throw new Error(`Builder modified unrelated files: ${unexpected.join(", ")}`);
}

function workState(passed: boolean): WorkState {
  return {
    goalId: "goal-real-builder-e2e",
    objective: "Prove real ZBook/Codex autonomous recovery reaches verified fixture target beta",
    definitionOfDone: [
      { id: "fixture-beta", description: "Controlled fixture contains exactly beta", required: true },
    ],
    currentState: passed ? "verified" : "recovery",
    status: passed ? "VERIFYING" : "IN_PROGRESS",
    riskClass: "R1",
    constraints: ["Only the controlled fixture may change"],
    decisions: [],
    artifacts: [],
    verificationResults: [{ itemId: "fixture-beta", passed, evidence: { expected: "beta" } }],
    childWorkItems: [],
    blockers: [],
    nextAction: passed ? null : "Run alternate strategy",
    updatedAt: new Date().toISOString(),
  };
}

const builder = new HttpWorkerBuilderCapability("zbook-real-code-builder", { url: endpoint, token });
const evidence: Record<string, unknown> = {
  goalId: "goal-real-builder-e2e",
  startedAt: new Date().toISOString(),
  endpoint,
  attempts: [],
};

try {
  await git(["checkout", "--", fixture]);

  const available = await builder.available();
  evidence.builderAvailable = available;
  if (!available) throw new Error("Real ZBook code-builder is unavailable");

  const first = await builder.build({
    goalId: "goal-real-builder-e2e",
    attemptId: "attempt-1",
    strategyId: "strategy-alpha",
    objective: `Edit only ${fixture}. Make its complete content exactly: alpha. Do not modify any other file.`,
    files: [fixture],
    context: [],
  });
  const firstActual = await fixtureValue();
  const firstFiles = await changedFiles();
  assertBoundedChanges(firstFiles);
  const firstVerified = first.ok && firstActual === "beta";
  const failureSignature = firstVerified ? null : `fixture_expected_beta_actual_${firstActual || "empty"}`;
  (evidence.attempts as unknown[]).push({
    attemptId: "attempt-1",
    strategyId: "strategy-alpha",
    builder: first,
    acceptance: { expected: "beta", actual: firstActual, passed: firstVerified },
    changedFiles: firstFiles,
    failureSignature,
  });

  if (firstVerified) throw new Error("First strategy unexpectedly satisfied beta; intentional failure was not observed");

  const recovery = evaluateRecovery({
    failureSignature: failureSignature!,
    failureClass: "implementation",
    attemptsForSignature: 1,
    strategyPivots: 0,
    totalAttempts: 1,
  }, {
    maxAttemptsPerSignature: 1,
    maxStrategyPivots: 2,
    maxTotalAttempts: 4,
  });
  evidence.recoveryDecision = recovery;
  if (recovery.action !== "strategy_pivot") {
    throw new Error(`Expected strategy_pivot, got ${recovery.action}`);
  }

  const second = await builder.build({
    goalId: "goal-real-builder-e2e",
    attemptId: "attempt-2",
    strategyId: "strategy-beta",
    objective: `The previous strategy produced "${firstActual}" and failed verified acceptance. Correct only ${fixture}. Make its complete content exactly: beta. Do not modify any other file.`,
    files: [fixture],
    context: [{
      source: "verifier",
      summary: "Acceptance failed: expected beta",
      data: { failureSignature, expected: "beta", actual: firstActual },
    }],
    previousFailureSignatures: [failureSignature!],
  });
  const secondActual = await fixtureValue();
  const secondFiles = await changedFiles();
  assertBoundedChanges(secondFiles);
  const secondVerified = second.ok && secondActual === "beta";
  (evidence.attempts as unknown[]).push({
    attemptId: "attempt-2",
    strategyId: "strategy-beta",
    builder: second,
    acceptance: { expected: "beta", actual: secondActual, passed: secondVerified },
    changedFiles: secondFiles,
  });

  const goalEvaluation = evaluateGoalFromWorkState(workState(secondVerified));
  evidence.goalEvaluation = goalEvaluation;
  evidence.completedAt = new Date().toISOString();
  evidence.status = goalEvaluation.achieved ? "GOAL_ACHIEVED" : "GOAL_NOT_ACHIEVED";

  if (!secondVerified || !goalEvaluation.achieved) {
    throw new Error("Alternate real Builder strategy did not achieve verified Goal");
  }

  await mkdir(resolve(process.cwd(), ".gai-results"), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
} catch (error) {
  evidence.completedAt = new Date().toISOString();
  evidence.status = "FAILED";
  evidence.error = error instanceof Error ? error.message : String(error);
  await mkdir(resolve(process.cwd(), ".gai-results"), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  process.stderr.write(JSON.stringify(evidence, null, 2) + "\n");
  process.exitCode = 1;
} finally {
  await git(["checkout", "--", fixture]).catch(() => undefined);
}
