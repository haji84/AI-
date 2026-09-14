import type { ActionResult, CapabilityExecutor, ContextItem, ProposedAction } from "../orchestrator/goal-loop.ts";
import type { ResearchRouteDecision, ResearchWorkKind } from "./research-control-plane.ts";

export interface ResearchExecutionRequest {
  id: string;
  query: string;
  kind: ResearchWorkKind;
  route: ResearchRouteDecision;
  context: ContextItem[];
}

export interface ResearchExecutionResult {
  ok: boolean;
  summary: string;
  evidence?: unknown;
  blocker?: string;
}

export interface ResearchHostedRunner {
  execute(request: ResearchExecutionRequest): Promise<ResearchExecutionResult>;
}

export interface ResearchWorkerRunner {
  execute(request: ResearchExecutionRequest, workerId: string): Promise<ResearchExecutionResult>;
}

export interface GeneralResearchExecutorOptions {
  hosted: ResearchHostedRunner;
  worker?: ResearchWorkerRunner;
}

export class GeneralResearchExecutor {
  private readonly hosted: ResearchHostedRunner;
  private readonly worker?: ResearchWorkerRunner;

  constructor(options: GeneralResearchExecutorOptions) {
    this.hosted = options.hosted;
    this.worker = options.worker;
  }

  async execute(request: ResearchExecutionRequest): Promise<ResearchExecutionResult> {
    if (request.route.action === "defer") {
      return {
        ok: false,
        summary: request.route.reason,
        blocker: request.route.queueState ?? "RESEARCH_DEFERRED",
        evidence: { route: request.route },
      };
    }

    if (request.route.action === "run-hosted") {
      return this.hosted.execute(request);
    }

    const workerId = request.route.workerId?.trim();
    if (!workerId) {
      return {
        ok: false,
        summary: "Research control plane selected worker execution without a worker id",
        blocker: "RESEARCH_WORKER_ID_MISSING",
        evidence: { route: request.route },
      };
    }
    if (!this.worker) {
      return {
        ok: false,
        summary: `Research worker ${workerId} was selected, but no research worker runner is registered`,
        blocker: "RESEARCH_WORKER_RUNNER_UNAVAILABLE",
        evidence: { route: request.route, workerId },
      };
    }
    return this.worker.execute(request, workerId);
  }
}

function evidenceContext(context: ContextItem[]): ContextItem[] {
  return context.filter((item) => item.source !== "state.next_action" && item.source !== "goal.complete");
}

export function createCapabilityBackedHostedResearchRunner(downstream: CapabilityExecutor): ResearchHostedRunner {
  return {
    async execute(request) {
      const researchContext = evidenceContext(request.context);
      if (researchContext.length === 0) {
        return {
          ok: false,
          summary: `No bounded evidence is available for research query: ${request.query}`,
          blocker: "RESEARCH_EVIDENCE_UNAVAILABLE",
          evidence: { route: request.route, kind: request.kind },
        };
      }

      const action: ProposedAction = {
        id: `${request.id}:hosted-research`,
        description: `Research ${request.kind}: ${request.query}`,
        capability: "context.inspect",
        risk: "low",
        irreversible: false,
        externalSideEffect: false,
        input: {
          query: request.query,
          researchKind: request.kind,
        },
      };
      const result: ActionResult = await downstream.execute(action, researchContext);
      return {
        ok: result.ok,
        summary: result.ok
          ? `Hosted research completed: ${request.query}`
          : result.summary,
        blocker: result.blocker,
        evidence: {
          route: request.route,
          kind: request.kind,
          query: request.query,
          sources: [...new Set(researchContext.map((item) => item.source))],
          result: result.evidence,
        },
      };
    },
  };
}
