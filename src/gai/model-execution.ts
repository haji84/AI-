import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ModelRoute, ModelTier, TaskProfile } from "./types.ts";
import { routeModel } from "./model-router.ts";

export interface ModelExecutionRequest {
  task: TaskProfile;
  prompt: string;
  planIncludedTiers?: ModelTier[];
}

export interface ModelExecutionResult {
  tier: ModelTier;
  output: string;
  provider: string;
  incrementalApiCost: 0;
}

export interface ModelExecutionAdapter {
  readonly tier: ModelTier;
  readonly provider: string;
  readonly planIncluded: boolean;
  execute(prompt: string): Promise<string>;
}

export interface UsageRecord {
  taskId: string;
  tier: ModelTier;
  provider: string;
  attemptedAt: string;
  success: boolean;
  reason: string;
  incrementalApiCost: 0;
}

export class FileUsageLedger {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async list(): Promise<UsageRecord[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as UsageRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async append(record: UsageRecord): Promise<void> {
    const records = await this.list();
    records.push(record);
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    await writeFile(temp, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await rename(temp, this.path);
  }
}

export class GovernedModelExecutor {
  private readonly adapters = new Map<ModelTier, ModelExecutionAdapter>();
  private readonly ledger: FileUsageLedger;

  constructor(adapters: ModelExecutionAdapter[], ledger: FileUsageLedger) {
    this.ledger = ledger;
    for (const adapter of adapters) this.adapters.set(adapter.tier, adapter);
  }

  async execute(request: ModelExecutionRequest): Promise<ModelExecutionResult> {
    const route = routeModel(request.task);
    const candidates = this.allowedCandidates(route, request.planIncludedTiers ?? []);
    let lastReason = "No eligible zero-cost model adapter is available.";

    for (const tier of candidates) {
      const adapter = this.adapters.get(tier);
      if (!adapter) continue;
      if (tier !== "local" && !adapter.planIncluded) {
        lastReason = `${tier} adapter is not plan-included; pay-as-you-go fallback is prohibited.`;
        await this.record(request.task.id, adapter, false, lastReason);
        continue;
      }

      try {
        const output = await adapter.execute(request.prompt);
        await this.record(request.task.id, adapter, true, route.reason);
        return { tier, output, provider: adapter.provider, incrementalApiCost: 0 };
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
        await this.record(request.task.id, adapter, false, lastReason);
      }
    }

    throw new Error(`Model execution unavailable without incremental API cost: ${lastReason}`);
  }

  private allowedCandidates(route: ModelRoute, planIncludedTiers: ModelTier[]): ModelTier[] {
    const requested = [route.tier, ...route.fallback];
    return requested.filter((tier, index) =>
      requested.indexOf(tier) === index && (tier === "local" || planIncludedTiers.includes(tier)),
    );
  }

  private async record(taskId: string, adapter: ModelExecutionAdapter, success: boolean, reason: string) {
    await this.ledger.append({
      taskId,
      tier: adapter.tier,
      provider: adapter.provider,
      attemptedAt: new Date().toISOString(),
      success,
      reason,
      incrementalApiCost: 0,
    });
  }
}
