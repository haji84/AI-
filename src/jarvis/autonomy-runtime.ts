import type { UnifiedIntakeRequest } from "../orchestrator/goal-controller-runtime.ts";
import type { UnifiedEntryRuntime } from "../orchestrator/unified-entry-runtime.ts";
import type { GoalControllerExecutionBridge, GoalExecutionResult } from "../orchestrator/goal-controller-execution-bridge.ts";
import type { JarvisControlPlane } from "./control-plane.ts";

export interface JarvisAutonomyRunResult {
  intake: Awaited<ReturnType<UnifiedEntryRuntime["handle"]>>;
  execution: GoalExecutionResult;
  queuedTaskId?: string;
}

export class JarvisAutonomyRuntime {
  private readonly entry: UnifiedEntryRuntime;
  private readonly bridge: GoalControllerExecutionBridge;
  private readonly controlPlane?: JarvisControlPlane;

  constructor(input: { entry: UnifiedEntryRuntime; bridge: GoalControllerExecutionBridge; controlPlane?: JarvisControlPlane }) {
    this.entry = input.entry;
    this.bridge = input.bridge;
    this.controlPlane = input.controlPlane;
  }

  async handle(request: UnifiedIntakeRequest): Promise<JarvisAutonomyRunResult> {
    const intake = await this.entry.handle(request);
    const execution = await this.bridge.execute(intake.decision, intake.context);

    let queuedTaskId: string | undefined;
    if (execution.executed && execution.report && this.controlPlane) {
      const last = execution.report.cycles.at(-1);
      if (last?.stopReason === "continue" && last.nextAction) {
        const task = this.controlPlane.enqueueTask({
          idempotencyKey: `goal:${intake.decision.goalId}:next:${last.action?.id ?? "cycle"}`,
          type: "goal-next-action",
          payload: {
            goalId: intake.decision.goalId,
            nextAction: last.nextAction,
            recovery: last.recoveryDecision ?? null,
          },
          requiredCapabilities: [],
          priority: "normal",
          requiresOnline: false,
          maxAttempts: 3,
        });
        queuedTaskId = task.id;
      }
    }

    return { intake, execution, queuedTaskId };
  }
}
