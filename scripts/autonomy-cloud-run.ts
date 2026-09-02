import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { ensureCloudGoal, applyCloudControl, GitHubRepositoryContextSource } from "../src/orchestrator/cloud-runtime.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { RepositoryFileContextSource } from "../src/orchestrator/context-adapters.ts";
import { dispatchAutonomyEvent, EventContextSource } from "../src/orchestrator/event-runtime.ts";
import { GoalDrivenLoop, type Verifier } from "../src/orchestrator/goal-loop.ts";
import { githubRuntimeConfig, LiveGitHubReadClient } from "../src/orchestrator/github-live-client.ts";
import { createLocalBlockerCapability, GitHubModelsPlanningClient, ModelBackedPlanner } from "../src/orchestrator/model-planner.ts";
import { createSafePrProposalCapability } from "../src/orchestrator/safe-pr-capability.ts";

const args = process.argv.slice(2);
const mode = (args.find((v) => v.startsWith("--mode="))?.split("=")[1] ?? "run") as "run" | "pause" | "resume" | "status";
const maxCycles = Number(args.find((v) => v.startsWith("--max-cycles="))?.split("=")[1] ?? "3");
if (!["run", "pause", "resume", "status"].includes(mode)) throw new Error(`unsupported mode: ${mode}`);
if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 20) throw new Error("max-cycles must be an integer from 1 to 20");

const stateDir = process.env.AUTONOMY_STATE_DIR?.trim() || resolve(process.cwd(), ".autonomy-state");
mkdirSync(stateDir, { recursive: true });
const dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(stateDir, "compass.db");
const summaryPath = process.env.AUTONOMY_SUMMARY_PATH?.trim() || resolve(stateDir, "run-summary.json");
const compass = new CompassStore(dbPath);

try {
  ensureCloudGoal(compass);
  applyCloudControl(compass, mode);
  const before = compass.getState();

  let report: unknown = null;
  if (mode === "run" || mode === "resume") {
    const config = githubRuntimeConfig(process.env);
    const github = new LiveGitHubReadClient(config);
    const token = process.env.GITHUB_TOKEN?.trim() || "";
    const event = {
      type: process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" as const : "manual" as const,
      id: process.env.GITHUB_RUN_ID ? `github-run-${process.env.GITHUB_RUN_ID}` : `cloud-${Date.now()}`,
      summary: process.env.GITHUB_EVENT_NAME === "schedule" ? "scheduled mobile-first autonomy run" : "mobile/manual cloud autonomy run",
    };
    const registry = new CapabilityRegistry()
      .register(createContextInspectCapability())
      .register(createLocalBlockerCapability())
      .register(createSafePrProposalCapability({ token, repository: config.repository }));
    const verifier: Verifier = {
      async verify({ result }) {
        return { ok: result.ok, summary: result.ok ? "Cloud capability execution verified" : result.summary, evidence: result.evidence };
      },
    };
    const planner = new ModelBackedPlanner(new GitHubModelsPlanningClient(token));
    const loop = new GoalDrivenLoop(
      planner,
      [new EventContextSource(event), new RepositoryFileContextSource(), new GitHubRepositoryContextSource(github)],
      registry,
      verifier,
      new CompassStateStoreAdapter(compass),
    );
    const goal = compass.getGoal();
    if (!goal) throw new Error("cloud goal bootstrap failed");
    report = await dispatchAutonomyEvent({ event, loop, goal: compassGoalToLoopGoal(goal), compass, maxCycles });
  }

  const after = compass.getState();
  const output = {
    mode,
    dbPath,
    status: after.status,
    paused: after.status === "PAUSED",
    nextAction: after.nextAction,
    blockers: after.blockers,
    verificationSummary: after.verificationSummary,
    report,
    previousStatus: before.status,
    updatedAt: after.updatedAt,
  };
  writeFileSync(summaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  compass.close();
}
