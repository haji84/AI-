import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import {
  awaitingCommandOutcome,
  goalDraftNotReadyOutcome,
  isMissingPersistentCommandError,
  staleCommandInvalidationOutcome,
  type AutonomyLifecycleOutcome,
} from "../src/orchestrator/autonomy-run-outcome.ts";
import { createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { ensureCloudGoal, applyCloudControl, CloudCompassStateStoreAdapter, GitHubRepositoryContextSource } from "../src/orchestrator/cloud-runtime.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { BoundedWorkspaceReader, RepositoryFileContextSource } from "../src/orchestrator/context-adapters.ts";
import { dispatchAutonomyEvent, EventContextSource } from "../src/orchestrator/event-runtime.ts";
import { applyExecutionReadyGoalDraft } from "../src/orchestrator/goal-draft-compass.ts";
import { DefaultApprovalPolicy, GoalDrivenLoop, type Verifier } from "../src/orchestrator/goal-loop.ts";
import { githubRuntimeConfig, LiveGitHubReadClient } from "../src/orchestrator/github-live-client.ts";
import { parseHumanGateShortcut, resolveHumanGateShortcut, type HumanGateShortcutResolution } from "../src/orchestrator/human-gate-shortcuts.ts";
import { createLocalBlockerCapability, ModelBackedPlanner } from "../src/orchestrator/model-planner.ts";
import { shouldValidatePersistedTarget } from "../src/orchestrator/persisted-target-policy.ts";
import { invalidatePersistedCommandIfTargetClosed, resolvePersistentCommandEnvelope } from "../src/orchestrator/persistent-command-handoff.ts";
import { readReasoningUsage, recordReasoningUse } from "../src/orchestrator/reasoning-budget.ts";
import { buildReasoningFeedback, type ReasoningFeedback } from "../src/orchestrator/reasoning-feedback.ts";
import { DEFAULT_REASONING_SOFT_BUDGETS, type ReasoningSoftBudgets } from "../src/orchestrator/reasoning-router.ts";
import { createSafePrProposalCapability } from "../src/orchestrator/safe-pr-capability.ts";
import { TeamAwarePlanner } from "../src/orchestrator/team-aware-planner.ts";
import { UnifiedPlanningClient } from "../src/orchestrator/unified-planning-client.ts";

const args = process.argv.slice(2);
const mode = (args.find((v) => v.startsWith("--mode="))?.split("=")[1] ?? "status") as "run" | "pause" | "resume" | "status";
const maxCycles = Number(args.find((v) => v.startsWith("--max-cycles="))?.split("=")[1] ?? "3");
if (!["run", "pause", "resume", "status"].includes(mode)) throw new Error(`unsupported mode: ${mode}`);
if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 20) throw new Error("max-cycles must be an integer from 1 to 20");

function softBudgetFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

const reasoningSoftBudgets: ReasoningSoftBudgets = {
  work: softBudgetFromEnv("REASONING_WORK_SOFT_DAILY_BUDGET", DEFAULT_REASONING_SOFT_BUDGETS.work),
  codex: softBudgetFromEnv("REASONING_CODEX_SOFT_DAILY_BUDGET", DEFAULT_REASONING_SOFT_BUDGETS.codex),
};
const stateDir = process.env.AUTONOMY_STATE_DIR?.trim() || resolve(process.cwd(), ".autonomy-state");
mkdirSync(stateDir, { recursive: true });
const dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(stateDir, "compass.db");
const summaryPath = process.env.AUTONOMY_SUMMARY_PATH?.trim() || resolve(stateDir, "run-summary.json");
const feedbackPath = process.env.AUTONOMY_FEEDBACK_PATH?.trim() || resolve(stateDir, "reasoning-feedback.json");
const envApprovedActionKey = process.env.AUTONOMY_APPROVAL_KEY?.trim() || null;
const compass = new CompassStore(dbPath);

function readPreviousReasoningFeedback(): ReasoningFeedback | null {
  try {
    return JSON.parse(readFileSync(feedbackPath, "utf-8")) as ReasoningFeedback;
  } catch {
    return null;
  }
}

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
  let commandSource: "chat" | "work" | "codex" | null = null;
  let command: string | null = null;
  let lifecycleOutcome: AutonomyLifecycleOutcome | null = null;
  let freshCommandHandoff = false;
  let shortcutResolution: HumanGateShortcutResolution | null = null;
  let preservedFeedback: ReasoningFeedback | null = null;

  if (mode === "run" || mode === "resume") {
    const config = githubRuntimeConfig(process.env);
    const github = new LiveGitHubReadClient(config);
    const token = process.env.GITHUB_TOKEN?.trim() || "";
    const explicitJson = process.env.AUTONOMY_COMMAND_JSON?.trim() || "";
    let effectiveExplicitJson = explicitJson;
    let effectiveApprovedActionKey = envApprovedActionKey;
    let shortcutHandledWithoutExecution = false;

    if (explicitJson) {
      try {
        const shortcutClient = new UnifiedPlanningClient(explicitJson);
        const shortcut = parseHumanGateShortcut(shortcutClient.command.command);
        if (shortcut.kind !== "none") {
          commandSource = shortcutClient.command.source;
          command = shortcutClient.command.command;
          shortcutResolution = resolveHumanGateShortcut(shortcut, readPreviousReasoningFeedback());
          effectiveExplicitJson = "";
          freshCommandHandoff = false;

          if (shortcut.kind === "check" || !shortcutResolution.approvedActionKey) {
            preservedFeedback = readPreviousReasoningFeedback();
            report = { humanGateShortcut: shortcutResolution };
            shortcutHandledWithoutExecution = true;
          } else {
            effectiveApprovedActionKey = shortcutResolution.approvedActionKey;
          }
        }
      } catch {
        // Invalid or non-shortcut input continues through the normal command path.
      }
    }

    let envelopeJson: string | null = null;
    if (!shortcutHandledWithoutExecution) {
      try {
        envelopeJson = resolvePersistentCommandEnvelope({ explicitJson: effectiveExplicitJson, stateDir });
      } catch (error) {
        if (!effectiveExplicitJson && isMissingPersistentCommandError(error)) lifecycleOutcome = awaitingCommandOutcome();
        else throw error;
      }
    }

    if (envelopeJson) {
      const planningClient = new UnifiedPlanningClient(envelopeJson);
      if (!shortcutResolution) {
        commandSource = planningClient.command.source;
        command = planningClient.command.command;
        freshCommandHandoff = Boolean(effectiveExplicitJson);
      }

      if (shouldValidatePersistedTarget(effectiveExplicitJson)) {
        const repositoryState = await github.readRepositoryState();
        const openIssues = openIssueNumbers(repositoryState);
        if (openIssues) {
          const closedTarget = invalidatePersistedCommandIfTargetClosed({ envelopeJson, stateDir, openIssueNumbers: openIssues });
          if (closedTarget) lifecycleOutcome = staleCommandInvalidationOutcome(closedTarget);
        }
      }

      if (!lifecycleOutcome && planningClient.command.goalDraft) {
        const goalResult = applyExecutionReadyGoalDraft(compass, planningClient.command.goalDraft);
        if (!goalResult.ready) lifecycleOutcome = goalDraftNotReadyOutcome(goalResult.reasons);
      }

      if (!lifecycleOutcome) {
        const event = {
          type: process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" as const : "manual" as const,
          id: process.env.GITHUB_RUN_ID ? `github-run-${process.env.GITHUB_RUN_ID}` : `cloud-${Date.now()}`,
          summary: shortcutResolution
            ? `${commandSource ?? "chat"} Human Gate shortcut: ${command}`
            : `${planningClient.command.source} command: ${planningClient.command.command}`,
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
        const planner = new TeamAwarePlanner(basePlanner, { explicitBoundedPlan: Boolean(planningClient.command.plan) });
        const loop = new GoalDrivenLoop(
          planner,
          [new EventContextSource(event), new RepositoryFileContextSource(), new GitHubRepositoryContextSource(github)],
          registry,
          verifier,
          new CloudCompassStateStoreAdapter(compass),
          new DefaultApprovalPolicy(),
          { approvedActionKey: effectiveApprovedActionKey },
        );
        const goal = compass.getGoal();
        if (!goal) throw new Error("cloud goal bootstrap failed");
        report = await dispatchAutonomyEvent({ event, loop, goal: compassGoalToLoopGoal(goal), compass, maxCycles });
      }
    }
  }

  const after = compass.getState();
  const nextAction = lifecycleOutcome && "nextAction" in lifecycleOutcome ? lifecycleOutcome.nextAction : after.nextAction;
  const goalReadinessReasons = lifecycleOutcome?.status === "goal_draft_not_ready" ? lifecycleOutcome.goalReadinessReasons : [];
  const status = lifecycleOutcome?.status ?? after.status;
  const verificationSummary = lifecycleOutcome?.verificationSummary ?? after.verificationSummary;
  const reasoningUsage = freshCommandHandoff
    ? recordReasoningUse(stateDir, commandSource)
    : readReasoningUsage(stateDir);
  const output = {
    mode,
    commandSource,
    command,
    humanGateShortcut: shortcutResolution,
    dbPath,
    status,
    compassStatus: after.status,
    invalidatedIssue: lifecycleOutcome?.invalidatedIssue ?? null,
    goalReadinessReasons,
    paused: after.status === "PAUSED",
    nextAction,
    blockers: after.blockers,
    verificationSummary,
    report,
    previousStatus: before.status,
    updatedAt: after.updatedAt,
  };
  const feedback = preservedFeedback ?? buildReasoningFeedback({
    goal: compass.getGoal(),
    state: after,
    status,
    commandSource,
    command,
    blockers: after.blockers,
    verificationSummary,
    nextAction,
    report,
    reasoningUsage,
    reasoningSoftBudgets,
  });
  writeFileSync(summaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  writeFileSync(feedbackPath, `${JSON.stringify(feedback, null, 2)}\n`, "utf-8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  compass.close();
}
