import type { BuilderCapability, BuilderRequest } from "../orchestrator/builder-router.ts";
import type { ActionResult } from "../orchestrator/goal-loop.ts";

export interface HttpCodeBuilderEndpoint {
  url: string;
  token: string;
}

export class HttpWorkerBuilderCapability implements BuilderCapability {
  readonly id: string;
  private readonly endpoint: HttpCodeBuilderEndpoint;
  private readonly fetchImpl: typeof fetch;

  constructor(id: string, endpoint: HttpCodeBuilderEndpoint, fetchImpl: typeof fetch = fetch) {
    this.id = id;
    this.endpoint = { url: endpoint.url.replace(/\/$/, ""), token: endpoint.token };
    this.fetchImpl = fetchImpl;
  }

  async available(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.endpoint.url}/health`, {
        headers: { Authorization: `Bearer ${this.endpoint.token}` },
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null) as { capabilities?: unknown } | null;
      return Array.isArray(payload?.capabilities) && payload.capabilities.includes("code-builder");
    } catch {
      return false;
    }
  }

  async build(request: BuilderRequest): Promise<ActionResult> {
    try {
      const response = await this.fetchImpl(`${this.endpoint.url}/build`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.endpoint.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => null) as {
        ok?: boolean; summary?: string; blocker?: string; evidence?: unknown;
      } | null;
      if (!response.ok || !payload) {
        return { actionId: request.attemptId, ok: false, summary: `Builder HTTP ${response.status}`, blocker: "http_code_builder_error" };
      }
      return {
        actionId: request.attemptId,
        ok: payload.ok === true,
        summary: payload.summary ?? "Builder returned no summary",
        blocker: payload.ok === true ? undefined : payload.blocker ?? "http_code_builder_failed",
        evidence: { builderId: this.id, strategyId: request.strategyId, remoteEvidence: payload.evidence ?? null },
      };
    } catch (error) {
      return {
        actionId: request.attemptId,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        blocker: "http_code_builder_unreachable",
        evidence: { builderId: this.id },
      };
    }
  }
}

export function createEnvHttpWorkerBuilders(env: Record<string, string | undefined> = process.env): HttpWorkerBuilderCapability[] {
  const raw = env.CODE_BUILDER_ENDPOINTS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, { url?: unknown; token?: unknown }>;
    return Object.entries(parsed).flatMap(([id, value]) => {
      if (!value || typeof value.url !== "string" || typeof value.token !== "string") return [];
      const url = value.url.trim();
      const token = value.token.trim();
      if (!url.startsWith("https://") || !token) return [];
      return [new HttpWorkerBuilderCapability(id, { url, token })];
    });
  } catch {
    return [];
  }
}
