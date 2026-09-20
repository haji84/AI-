import { freemem } from "node:os";
import { ModelRouterV2, type ModelCandidate, type RouteRequest } from "../jarvis/model-router-v2.ts";
import type { ModelRoute, ModelTier, TaskProfile } from "./types.ts";
import { routeModel } from "./model-router.ts";
import { PersistentUsageLedger } from "./usage-ledger.ts";

export type ModelRoutingConstraints = Omit<RouteRequest, "availableRamGb" | "availableVramGb">;
export interface ModelResourceObservation { availableRamGb:number; availableVramGb:number; observedAtMs:number }
export interface ModelRuntimeDescription { model:ModelCandidate; resources:ModelResourceObservation }
/** Actual local RAM sample. Unknown VRAM defaults to zero, never an invented GPU. */
export function localModelResources(availableVramGb=0):ModelResourceObservation {
  return {availableRamGb:freemem()/1024**3,availableVramGb,observedAtMs:Date.now()};
}

export interface ModelExecutionRequest {
  task: TaskProfile;
  input: string;
  allowFrontierEscalation?: boolean;
  routing?: ModelRoutingConstraints;
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
  describe?(): Promise<ModelRuntimeDescription>;
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
    const authorizedTiers = this.#candidateTiers(route, Boolean(request.allowFrontierEscalation));
    const localOnly=process.env.LOCAL_ONLY==='true'||request.routing?.localOnly===true;
    const routing=request.routing ? {...request.routing,localOnly} : undefined;
    const tiers = await this.#rankTiers(authorizedTiers.filter(tier=>!localOnly||tier==='local'),routing);
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

      // Re-sample just before execution, including after an awaited availability check.
      if(routing && !await this.#eligibleModel(adapter,routing)) {
        fallbackReason = `${tier} model/resource constraints are unavailable or incompatible.`;
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

  async #eligibleModel(adapter:ModelExecutionAdapter,routing:ModelRoutingConstraints):Promise<ModelCandidate|null> {
    if(!adapter.describe || (adapter.tier!=="local"&&!adapter.planIncluded))return null;
    try {
      const records=(await this.ledger.list()).filter(r=>r.provider===adapter.provider&&r.executedTier===adapter.tier&&Number.isFinite(r.durationMs)&&r.durationMs>=0).slice(-50);
      const description=await adapter.describe();
      const {model,resources}=description;
      const now=Date.now();
      if(!resources||!Number.isFinite(resources.observedAtMs)||resources.observedAtMs>now+5000||now-resources.observedAtMs>60000||model.local!==(adapter.tier==='local'))return null;
      const candidate:ModelCandidate={...model,id:adapter.tier,resources:{availableRamGb:resources.availableRamGb,availableVramGb:resources.availableVramGb}};
      if(records.length){candidate.successRate=records.filter(r=>r.success).length/records.length;candidate.latencyMs=records.reduce((sum,r)=>sum+r.durationMs,0)/records.length;}
      return new ModelRouterV2().route({...routing,availableRamGb:0,availableVramGb:0},[candidate]).selected;
    }catch{return null;}
  }

  async #rankTiers(tiers:ModelTier[],routing?:ModelRoutingConstraints):Promise<ModelTier[]> {
    if(!routing)return tiers; // Compatibility: legacy callers make no resource-aware claim.
    const candidates:ModelCandidate[]=[];
    for(const tier of tiers){const adapter=this.adapters.get(tier);if(!adapter)continue;const model=await this.#eligibleModel(adapter,routing);if(model)candidates.push(model);}
    const ranked=new ModelRouterV2().route({...routing,availableRamGb:0,availableVramGb:0},candidates);
    return ranked.selected ? [ranked.selected.id,...(ranked.alternates??[])] as ModelTier[] : [];
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
  describe?: () => Promise<ModelRuntimeDescription>;
  run: (input: string, task: TaskProfile) => Promise<string>;
}): ModelExecutionAdapter {
  return {
    describe: input.describe,
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
