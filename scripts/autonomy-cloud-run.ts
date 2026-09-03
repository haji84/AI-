import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { staleCommandInvalidationOutcome, type StaleCommandInvalidationOutcome } from "../src/orchestrator/autonomy-run-outcome.ts";
import { createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { ensureCloudGoal, applyCloudControl, CloudCompassStateStoreAdapter, GitHubRepositoryContextSource } from "../src/orchestrator/cloud-runtime.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { BoundedWorkspaceReader, RepositoryFileContextSource } from "../src/orchestrator/context-adapters.ts";
import { dispatchAutonomyEvent, EventContextSource } from "../src/orchestrator/event-runtime.ts";
import { GoalDrivenLoop, type Verifier } from "../src/orchestrator/goal-loop.ts";
import { githubRuntimeConfig, LiveGitHubReadClient } from "../src/orchestrator/github-live-client.ts";
import { createLocalBlockerCapability, ModelBackedPlanner } from "../src/orchestrator/model-planner.ts";
import { invalidatePersistedCommandIfTargetClosed, resolvePersistentCommandEnvelope } from "../src/orchestrator/persistent-command-handoff.ts";
import { createSafePrProposalCapability } from "../src/orchestrator/safe-pr-capability.ts";
import { TeamAwarePlanner } from "../src/orchestrator/team-aware-planner.ts";
import { UnifiedPlanningClient } from "../src/orchestrator/unified-planning-client.ts";

const args = process.argv.slice(2);
const mode = (args.find((v) => v.startsWith("--mode="))?.split("=")[1] ?? "status") as "run" | "pause" | "resume" | "status";
const maxCycles = Number(args.find((v) => v.startsWith("--max-cycles="))?.split("=")[1] ?? "3");
if (!["run", "pause", "resume", "status"].includes(mode)) throw new Error(`unsupported mode: ${mode}`);
if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 20) throw new Error("max-cycles must be an integer from 1 to 20");

const stateDir = process.env.AUTONOMY_STATE_DIR?.trim() || resolve(process.cwd(), ".autonomy-state");
mkdirSync(stateDir, { recursive: true });
const dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(stateDir, "compass.db");
const summaryPath = process.env.AUTONOMY_SUMMARY_PATH?.trim() || resolve(stateDir, "run-summary.json");
const compass = new CompassStore(dbPath);

function openIssueNumbers(repositoryState: unknown): number[] | null {
  if (!repositoryState || typeof repositoryState !== "object") return null;
  const state = repositoryState as { available?: unknown; openIssues?: unknown };
  if (state.available !== true || !Array.isArray(state.openIssues)) return null;
  return state.openIssues
    .map((issue) => issue && typeof issue === "object" ? Number((issue as { number?: unknown }).number) : NaN)
    .filter((number) => Number.isInteger(number) && number > 0);
}

try {
  ensureCloudGoal(compass);
  applyCloudControl(compass, mode);
  const before = compass.getState();

  let report: unknown = null;
  let commandSource: string | null = null;
  let command: string | null = null;
  let lifecycleOutcome: StaleCommandInvalidationOutcome | null = null;

  if (mode === "run" || mode === "resume") {
    const config = githubRuntimeConfig(process.env);
    const github = new LiveGitHubReadClient(config);
    const token = process.env.GITHUB_TOKEN?.trim() || "";
    const explicitJson = process.env.AUTONOMY_COMMAND_JSON?.trim() || "";
    const envelopeJson = resolvePersistentCommandEnvelope({
      explicitJson,
      stateDir,
    });
    const planningClient = new UnifiedPlanningClient(envelopeJson);
    commandSource = planningClient.command.source;
    command = planningClient.command.command;

    if (!explicitJson) {
      const repositoryState = await github.readRepositoryState();
      const openIssues = openIssueNumbers(repositoryState);
      if (openIssues) {
        const closedTarget = invalidatePersistedCommandIfTargetClosed({
          envelopeJson,
          stateDir,
          openIssueNumbers: openIssues,
        });
        if (closedTarget) lifecycleOutcome = staleCommandInvalidationOutcome(closedTarget);
      }
    }

    if (!lifecycleOutcome) {
      const event = {
        type: process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" as const : "manual" as const,
        id: process.env.GITHUB_RUN_ID ? `github-run-${process.env.GITHUB_RUN_ID}` : `cloud-${Date.now()}`,
        summary: `${planningClient.command.source} command: ${planningClient.command.command}`,
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
      const basePlanner = new ModelBackedPlanner(planningClient, new BoundedWorkspaceReader());
      const planner = new TeamAwarePlanner(basePlanner);
      const loop = new GoalDrivenLoop(
        planner,
        [new EventContextSource(event), new RepositoryFileContextSource(), new GitHubRepositoryContextSource(github)],
        registry,
        verifier,
        new CloudCompassStateStoreAdapter(compass),
      );
      const goal = compass.getGoal();
      if (!goal) throw new Error("cloud goal bootstrap failed");
      report = await dispatchAutonomyEvent({ event, loop, goal: compassGoalToLoopGoal(goal), compass, maxCycles });
    }
  }

  const after = compass.getState();
  const output = {
    mode,
    commandSource,
    command,
    dbPath,
    status: lifecycleOutcome?.status ?? after.status,
    compassStatus: after.status,
    invalidatedIssue: lifecycleOutcome?.invalidatedIssue ?? null,
    paused: after.status === "PAUSED",
    nextAction: after.nextAction,
    blockers: after.blockers,
    verificationSummary: lifecycleOutcome?.verificationSummary ?? after.verificationSummary,
    report,
    previousStatus: before.status,
    updatedAt: after.updatedAt,
  };
  writeFileSync(summaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  compass.close();
}
