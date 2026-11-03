import type { BuilderCapability, BuilderRequest } from "../orchestrator/builder-router.ts";
import type { ActionResult } from "../orchestrator/goal-loop.ts";
import type { DevelopmentBuilderKind } from "../orchestrator/development-builder.ts";
import { normalizeDevelopmentBuilderResult, type ForbiddenBuilderAuthority } from "../orchestrator/development-builder.ts";

export interface HttpCodeBuilderEndpoint {
  url: string;
  token: string;
}

export class HttpWorkerBuilderCapability implements BuilderCapability {
  readonly id: string;
  readonly kind: DevelopmentBuilderKind;
  private readonly endpoint: HttpCodeBuilderEndpoint;
  private readonly fetchImpl: typeof fetch;

  constructor(id: string, endpoint: HttpCodeBuilderEndpoint, fetchImpl: typeof fetch = fetch, kind: DevelopmentBuilderKind = "external") {
    this.id = id;
    this.endpoint = { url: endpoint.url.replace(/\/$/, ""), token: endpoint.token };
    this.fetchImpl = fetchImpl;
    this.kind = kind;
  }

  async available(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.endpoint.url}/health`, {
        headers: { Authorization: `Bearer ${this.endpoint.token}` },
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null) as { capabilities?: unknown; engine?: unknown; inference?: { locality?: unknown; networkAccess?: unknown } } | null;
      const capable = Array.isArray(payload?.capabilities) && payload.capabilities.includes("code-builder");
      if (!capable) return false;
      if (this.kind !== "local") return true;
      return payload?.inference?.locality === "device"
        && payload.inference.networkAccess === false
        && typeof payload.engine === "string"
        && !["codex", "aider", "unknown"].includes(payload.engine.toLowerCase());
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
        changedPaths?: unknown; patchDigest?: unknown; candidateRevision?: unknown; artifactDigest?: unknown; artifactRef?: unknown; tddPhase?: unknown; tddEvidenceDigest?: unknown; requestedAuthority?: unknown;
      } | null;
      if (!payload) {
        return {
          actionId: request.attemptId,
          ok: false,
          summary: `Builder HTTP ${response.status} returned no JSON payload`,
          blocker: "http_code_builder_error",
          evidence: { builderId: this.id, strategyId: request.strategyId, status: response.status },
        };
      }
      if (!response.ok) {
        return {
          actionId: request.attemptId,
          ok: false,
          summary: payload.summary ?? `Builder HTTP ${response.status}`,
          blocker: payload.blocker ?? "http_code_builder_error",
          evidence: {
            builderId: this.id,
            strategyId: request.strategyId,
            status: response.status,
            remoteEvidence: payload.evidence ?? null,
          },
        };
      }
      if (request.baseRevision || payload.changedPaths !== undefined || payload.patchDigest !== undefined) {
        try {
          const normalized = normalizeDevelopmentBuilderResult(request, {
            ok: payload.ok === true,
            summary: payload.summary ?? "Builder returned no summary",
            blocker: payload.blocker,
            evidence: payload.evidence && typeof payload.evidence === "object" && !Array.isArray(payload.evidence)
              ? payload.evidence as Record<string, unknown>
              : undefined,
            changedPaths: Array.isArray(payload.changedPaths)
              ? payload.changedPaths.filter((path): path is string => typeof path === "string")
              : undefined,
            patchDigest: typeof payload.patchDigest === "string" ? payload.patchDigest : undefined,
            candidateRevision: typeof payload.candidateRevision === "string" ? payload.candidateRevision : undefined,
            artifactDigest: typeof payload.artifactDigest === "string" ? payload.artifactDigest : undefined,
            artifactRef: typeof payload.artifactRef === "string" ? payload.artifactRef : undefined,
            tddPhase: payload.tddPhase === "red" || payload.tddPhase === "green" ? payload.tddPhase : undefined,
            tddEvidenceDigest: typeof payload.tddEvidenceDigest === "string" ? payload.tddEvidenceDigest : undefined,
            requestedAuthority: Array.isArray(payload.requestedAuthority)
              ? payload.requestedAuthority.filter((value): value is ForbiddenBuilderAuthority => typeof value === "string")
              : undefined,
          }, { builderId: this.id, kind: this.kind });
          return {
            actionId: request.attemptId,
            ok: normalized.ok,
            summary: normalized.summary,
            blocker: normalized.blocker,
            evidence: {
              builderId: this.id,
              builderKind: this.kind,
              strategyId: request.strategyId,
              changeSet: normalized.changeSet ?? null,
              remoteEvidence: normalized.evidence ?? null,
            },
          };
        } catch (error) {
          return {
            actionId: request.attemptId,
            ok: false,
            summary: error instanceof Error ? error.message : String(error),
            blocker: "http_code_builder_contract_rejected",
            evidence: { builderId: this.id, builderKind: this.kind, strategyId: request.strategyId },
          };
        }
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
