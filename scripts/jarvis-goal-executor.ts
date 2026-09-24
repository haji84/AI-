import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { CompassGoalBridgeEventStore } from "../src/orchestrator/compass-goal-bridge-event-store.ts";
import { GoalControllerExecutionBridge } from "../src/orchestrator/goal-controller-execution-bridge.ts";
import { createGoalBridgeEvent } from "../src/orchestrator/goal-bridge-events.ts";
import type { GoalControllerDecision } from "../src/orchestrator/goal-controller-runtime.ts";

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

async function main(): Promise<void> {
  const goalId = requiredEnv("JARVIS_GOAL_EXECUTION_GOAL_ID");
  const compassPath = requiredEnv("JARVIS_GOAL_EXECUTION_COMPASS_PATH");
  const context = decodeContext(process.env.JARVIS_GOAL_EXECUTION_CONTEXT_B64);
  const decision = executorDecision(goalId);
  try {
    const bridge = new GoalControllerExecutionBridge(new CompassGoalExecutionAdapter(compassPath));
    const result = await bridge.executeUntilGoalTerminal(decision, { maxRuns: 12, context });
    const report = result.report;
    const type = result.reason === "goal_complete"
      ? "GOAL_COMPLETED"
      : result.reason === "human_gate"
        ? "HUMAN_REQUIRED"
        : result.reason === "blocked" || result.reason === "retry_exhausted"
          ? "GOAL_BLOCKED"
          : "IMPORTANT_UPDATE";
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
