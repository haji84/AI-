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

export interface ResearchWorkerEndpoint {
  url: string;
  token: string;
}

export interface GeneralResearchExecutorOptions {
  hosted: ResearchHostedRunner;
  worker?: ResearchWorkerRunner;
}

function normalizedEndpoints(value: unknown): Record<string, ResearchWorkerEndpoint> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, ResearchWorkerEndpoint> = {};
  for (const [workerId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const endpoint = raw as { url?: unknown; token?: unknown };
    if (typeof endpoint.url !== "string" || typeof endpoint.token !== "string") continue;
    const url = endpoint.url.trim().replace(/\/$/, "");
    const token = endpoint.token.trim();
    if (!url.startsWith("https://") || !token) continue;
    result[workerId] = { url, token };
  }
  return result;
}

export function parseResearchWorkerEndpoints(json: string | undefined): Record<string, ResearchWorkerEndpoint> {
  if (!json?.trim()) return {};
  try {
    return normalizedEndpoints(JSON.parse(json));
  } catch {
    return {};
  }
}

export function createHttpResearchWorkerRunner(options: {
  endpoints: Record<string, ResearchWorkerEndpoint>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ResearchWorkerRunner {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;
  return {
    async execute(request, workerId) {
      const workerIds = workerId.split(",").map((value) => value.trim()).filter(Boolean);
      if (workerIds.length === 0) {
        return { ok: false, summary: "Research worker id is empty", blocker: "RESEARCH_WORKER_ID_MISSING" };
      }
      const outputs: Array<{ workerId: string; result: ResearchExecutionResult }> = [];
      for (const id of workerIds) {
        const endpoint = options.endpoints[id];
        if (!endpoint) {
          return {
            ok: false,
            summary: `Research worker ${id} has no configured endpoint`,
            blocker: "RESEARCH_WORKER_ENDPOINT_UNAVAILABLE",
            evidence: { workerId: id, configuredWorkerIds: Object.keys(options.endpoints) },
          };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(`${endpoint.url}/research`, {
            method: "POST",
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${endpoint.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              requestId: request.id,
              query: request.query,
              kind: request.kind,
              context: request.context,
            }),
          });
          const payload = await response.json().catch(() => null) as ResearchExecutionResult | null;
          if (!response.ok || !payload) {
            return {
              ok: false,
              summary: `Research worker ${id} returned HTTP ${response.status}`,
              blocker: "RESEARCH_WORKER_HTTP_ERROR",
              evidence: { workerId: id, status: response.status },
            };
          }
          outputs.push({ workerId: id, result: payload });
          if (!payload.ok) return payload;
        } catch (error) {
          return {
            ok: false,
            summary: error instanceof Error ? error.message : String(error),
            blocker: error instanceof Error && error.name === "AbortError"
              ? "RESEARCH_WORKER_TIMEOUT"
              : "RESEARCH_WORKER_UNREACHABLE",
            evidence: { workerId: id },
          };
        } finally {
          clearTimeout(timer);
        }
      }
      return {
        ok: true,
        summary: workerIds.length === 1
          ? outputs[0]?.result.summary ?? `Research worker ${workerIds[0]} completed`
          : `Cross-device research completed on ${workerIds.join(", ")}`,
        evidence: { workers: outputs },
      };
    },
  };
}

export function createEnvResearchWorkerRunner(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): ResearchWorkerRunner | undefined {
  const endpoints = parseResearchWorkerEndpoints(env.RESEARCH_WORKER_ENDPOINTS_JSON);
  if (Object.keys(endpoints).length === 0) return undefined;
  const timeoutMs = Number(env.RESEARCH_WORKER_TIMEOUT_MS || 120_000);
  return createHttpResearchWorkerRunner({
    endpoints,
    fetchImpl,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000,
  });
}

export class GeneralResearchExecutor {
  private readonly hosted: ResearchHostedRunner;
  private readonly worker?: ResearchWorkerRunner;

  constructor(options: GeneralResearchExecutorOptions) {
    this.hosted = options.hosted;
    this.worker = options.worker ?? createEnvResearchWorkerRunner();
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

    if (request.route.action === "run-hosted") return this.hosted.execute(request);

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
        input: { query: request.query, researchKind: request.kind },
      };
      const result: ActionResult = await downstream.execute(action, researchContext);
      return {
        ok: result.ok,
        summary: result.ok ? `Hosted research completed: ${request.query}` : result.summary,
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
