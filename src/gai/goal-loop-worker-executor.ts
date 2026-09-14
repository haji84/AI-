import type {
  ActionResult,
  CapabilityExecutor,
  ContextItem,
  ProposedAction,
} from "../orchestrator/goal-loop.ts";
import type { TaskProfile } from "./types.ts";
import {
  MultiWorkerRuntime,
  type WorkerCapability,
  type WorkerConnectivity,
  type WorkerExecutionMode,
  type WorkerExecutionRequest,
  type WorkerPlatform,
} from "./worker-runtime.ts";

export interface WorkerRoutingHints {
  requestedCapability: WorkerCapability;
  requiredCapabilities?: WorkerCapability[];
  preferredPlatform?: WorkerPlatform;
  requiredExecutionMode?: WorkerExecutionMode;
  connectivity?: WorkerConnectivity;
  allowOffline?: boolean;
}

export type GoalActionWorkerResolver = (
  action: ProposedAction,
  context: ContextItem[],
) => WorkerRoutingHints | null;

export interface GoalLoopWorkerExecutorOptions {
  runtime: MultiWorkerRuntime;
  resolve: GoalActionWorkerResolver;
}

function toTaskProfile(action: ProposedAction): TaskProfile {
  const risk = action.risk === "high" ? "HIGH" : action.risk === "medium" ? "MEDIUM" : "LOW";
  return {
    id: action.id,
    description: action.description,
    difficulty: action.risk === "high" ? 8 : action.risk === "medium" ? 5 : 3,
    requiresFrontierReasoning: false,
    requiresLongContext: false,
    requiresToolUse: true,
    risk,
  };
}

function encodeWorkerInput(action: ProposedAction, context: ContextItem[]): string {
  return JSON.stringify({
    action: {
      id: action.id,
      description: action.description,
      capability: action.capability,
      input: action.input ?? null,
    },
    context: context.map((item) => ({
      source: item.source,
      summary: item.summary,
      data: item.data ?? null,
    })),
  });
}

export class GoalLoopWorkerExecutor implements CapabilityExecutor {
  private readonly runtime: MultiWorkerRuntime;
  private readonly resolve: GoalActionWorkerResolver;

  constructor(options: GoalLoopWorkerExecutorOptions) {
    this.runtime = options.runtime;
    this.resolve = options.resolve;
  }

  async execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult> {
    const hints = this.resolve(action, context);
    if (!hints) {
      return {
        actionId: action.id,
        ok: false,
        summary: `No worker routing mapping is registered for capability ${action.capability}`,
        blocker: "WORKER_CAPABILITY_MAPPING_UNAVAILABLE",
        evidence: { actionCapability: action.capability },
      };
    }

    const request: WorkerExecutionRequest = {
      task: toTaskProfile(action),
      input: encodeWorkerInput(action, context),
      requestedCapability: hints.requestedCapability,
      requiredCapabilities: hints.requiredCapabilities ?? [hints.requestedCapability],
      preferredPlatform: hints.preferredPlatform,
      requiredExecutionMode: hints.requiredExecutionMode,
      connectivity: hints.connectivity,
      allowOffline: hints.allowOffline,
    };

    try {
      const selection = await this.runtime.select(request);
      const workerResult = await selection.worker.execute(request);
      return {
        actionId: action.id,
        ok: workerResult.ok,
        summary: workerResult.ok
          ? `Worker ${workerResult.workerId} completed ${action.description}`
          : `Worker ${workerResult.workerId} failed ${action.description}: ${workerResult.output}`,
        blocker: workerResult.ok ? undefined : "WORKER_EXECUTION_FAILED",
        evidence: {
          actionCapability: action.capability,
          requestedCapability: hints.requestedCapability,
          selectedWorkerId: workerResult.workerId,
          selectedPlatform: workerResult.platform,
          routingScore: selection.score,
          routingReasons: selection.reasons,
          workerOutput: workerResult.output,
          workerDurationMs: workerResult.durationMs,
          workerEvidence: workerResult.evidence ?? null,
        },
      };
    } catch (error) {
      return {
        actionId: action.id,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        blocker: "WORKER_ROUTING_FAILED",
        evidence: {
          actionCapability: action.capability,
          requestedCapability: hints.requestedCapability,
        },
      };
    }
  }
}

export function createStaticGoalActionWorkerResolver(
  mappings: Readonly<Record<string, WorkerRoutingHints>>,
): GoalActionWorkerResolver {
  return (action) => mappings[action.capability] ?? null;
}
