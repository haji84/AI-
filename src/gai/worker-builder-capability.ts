import type { ActionResult } from "../orchestrator/goal-loop.ts";
import type { BuilderCapability, BuilderRequest } from "../orchestrator/builder-router.ts";
import type { MultiWorkerRuntime, WorkerExecutionRequest } from "./worker-runtime.ts";

export class WorkerBuilderCapability implements BuilderCapability {
  readonly id = "worker-code-builder";
  readonly kind = "local" as const;
  private readonly runtime: MultiWorkerRuntime;
  private readonly preferredPlatform?: "windows" | "macos" | "linux";

  constructor(runtime: MultiWorkerRuntime, options: { preferredPlatform?: "windows" | "macos" | "linux" } = {}) {
    this.runtime = runtime;
    this.preferredPlatform = options.preferredPlatform;
  }

  async available(): Promise<boolean> {
    try {
      const request = this.request({
        goalId: "availability",
        attemptId: "availability",
        strategyId: "availability",
        objective: "code builder availability probe",
        context: [],
      });
      await this.runtime.select(request);
      return true;
    } catch {
      return false;
    }
  }

  async build(input: BuilderRequest): Promise<ActionResult> {
    const request = this.request(input);
    try {
      const selection = await this.runtime.select(request);
      const result = await selection.worker.execute(request);
      return {
        actionId: input.attemptId,
        ok: result.ok,
        summary: result.ok ? `Worker ${result.workerId} completed code build` : result.output,
        blocker: result.ok ? undefined : "worker_code_builder_failed",
        evidence: {
          builderId: this.id,
          workerId: result.workerId,
          platform: result.platform,
          strategyId: input.strategyId,
          workerEvidence: result.evidence ?? null,
        },
      };
    } catch (error) {
      return {
        actionId: input.attemptId,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        blocker: "worker_code_builder_unavailable",
        evidence: { builderId: this.id, strategyId: input.strategyId },
      };
    }
  }

  private request(input: BuilderRequest): WorkerExecutionRequest {
    return {
      task: {
        id: input.attemptId,
        description: input.objective,
        difficulty: 7,
        requiresFrontierReasoning: true,
        requiresLongContext: true,
        requiresToolUse: true,
        risk: "MEDIUM",
      },
      input: JSON.stringify({
        goalId: input.goalId,
        attemptId: input.attemptId,
        strategyId: input.strategyId,
        objective: input.objective,
        files: input.files ?? [],
        previousFailureSignatures: input.previousFailureSignatures ?? [],
        context: input.context,
      }),
      requestedCapability: "code-builder",
      requiredCapabilities: ["code-builder", "filesystem"],
      preferredPlatform: this.preferredPlatform,
      requiredExecutionMode: "resident",
      allowOffline: true,
    };
  }
}
