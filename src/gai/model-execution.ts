import type { ModelRoute, ModelTier, TaskProfile } from "./types.ts";
import { routeModel } from "./model-router.ts";
import { PersistentUsageLedger } from "./usage-ledger.ts";

export interface ModelExecutionRequest {
  task: TaskProfile;
  input: string;
  allowFrontierEscalation?: boolean;
}

export interface ModelExecutionResult {
  ok: boolean;
  output: string;
  requestedTier: ModelTier;
  executedTier: ModelTier;
  provider: string;
  planIncluded: boolean;
  durationMs: number;
  fallbackReason?: string;
}

export interface ModelExecutionAdapter {
  tier: ModelTier;
  provider: string;
  planIncluded: boolean;
  isAvailable(): Promise<boolean>;
  execute(input: string, task: TaskProfile): Promise<{ ok: boolean; output: string }>;
}

export interface ModelExecutionPolicy {
  paidApiFallbackAllowed: false;
  frontierEscalationRequiresExplicitPlan: true;
}

export const DEFAULT_MODEL_EXECUTION_POLICY: ModelExecutionPolicy = {
  paidApiFallbackAllowed: false,
  frontierEscalationRequiresExplicitPlan: true,
};

export class GovernedModelExecutor {
  private readonly adapters: Map<ModelTier, ModelExecutionAdapter>;
  private readonly ledger: PersistentUsageLedger;

  constructor(adapters: ModelExecutionAdapter[], ledger: PersistentUsageLedger) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.tier, adapter]));
    this.ledger = ledger;
  }

  async execute(request: ModelExecutionRequest): Promise<ModelExecutionResult> {
    const route = routeModel(request.task);
    const tiers = this.#candidateTiers(route, Boolean(request.allowFrontierEscalation));
    const started = Date.now();
    let fallbackReason: string | undefined;

    for (const tier of tiers) {
      const adapter = this.adapters.get(tier);
      if (!adapter) {
        fallbackReason = `No ${tier} execution adapter is configured.`;
        continue;
      }
      if (tier !== "local" && !adapter.planIncluded) {
        fallbackReason = `${tier} adapter is not plan-included; paid API fallback is prohibited.`;
        continue;
      }
      if (!(await adapter.isAvailable())) {
        fallbackReason = `${tier} execution capacity is unavailable.`;
        continue;
      }

      const result = await adapter.execute(request.input, request.task);
      const durationMs = Date.now() - started;
      const execution: ModelExecutionResult = {
        ok: result.ok,
        output: result.output,
        requestedTier: route.tier,
        executedTier: tier,
        provider: adapter.provider,
        planIncluded: adapter.planIncluded || tier === "local",
        durationMs,
        fallbackReason,
      };
      await this.ledger.append({
        id: `${request.task.id}:${Date.now()}:${tier}`,
        taskId: request.task.id,
        requestedTier: route.tier,
        executedTier: tier,
        provider: adapter.provider,
        planIncluded: execution.planIncluded,
        additionalApiCost: 0,
        success: result.ok,
        durationMs,
        fallbackReason,
      });
      return execution;
    }

    throw new Error(`No zero-cost execution path is available for task ${request.task.id}`);
  }

  #candidateTiers(route: ModelRoute, allowFrontierEscalation: boolean): ModelTier[] {
    if (route.tier === "local") return ["local"];
    if (!allowFrontierEscalation) return ["local"];
    return [route.tier, ...route.fallback.filter((tier) => tier !== route.tier)];
  }
}

export function createFunctionAdapter(input: {
  tier: ModelTier;
  provider: string;
  planIncluded: boolean;
  available?: () => boolean | Promise<boolean>;
  run: (input: string, task: TaskProfile) => Promise<string>;
}): ModelExecutionAdapter {
  return {
    tier: input.tier,
    provider: input.provider,
    planIncluded: input.planIncluded,
    async isAvailable() {
      return input.available ? Boolean(await input.available()) : true;
    },
    async execute(text, task) {
      try {
        return { ok: true, output: await input.run(text, task) };
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
