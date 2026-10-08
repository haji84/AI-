import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { BuilderRequest } from "./builder-router.ts";

export type DevelopmentBuilderKind = "local" | "external";
export type ForbiddenBuilderAuthority = "commit" | "push" | "merge" | "deploy" | "credential" | "permission";

export interface RawDevelopmentBuilderResult {
  ok: boolean;
  summary: string;
  changedPaths?: string[];
  patchDigest?: string;
  candidateRevision?: string;
  artifactDigest?: string;
  artifactRef?: string;
  tddPhase?: "red" | "green";
  tddEvidenceDigest?: string;
  requestedAuthority?: ForbiddenBuilderAuthority[];
  blocker?: string;
  evidence?: Record<string, unknown>;
}
export interface DevelopmentChangeSetEnvelope {
  goalId: string;
  attemptId: string;
  strategyId: string;
  baseRevision: string | null;
  builderId: string;
  builderKind: DevelopmentBuilderKind;
  changedPaths: string[];
  patchDigest: string;
  candidateRevision: string;
  artifactDigest: string;
  artifactRef: string;
  tddPhase?: "red" | "green";
  tddEvidenceDigest?: string;
  releaseAuthority: false;
}

export interface NormalizedDevelopmentBuilderResult {
  ok: boolean;
  summary: string;
  blocker?: string;
  changeSet?: DevelopmentChangeSetEnvelope;
  evidence?: Record<string, unknown>;
}

function canonicalPath(value: string): string {
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new Error(`Builder changed path outside declared scope: ${value}`);
  }
  return normalized;
}

export function developmentStrategyFingerprint(request: Pick<BuilderRequest, "objective" | "files" | "hypothesis">): string {
  return createHash("sha256").update(JSON.stringify({
    objective: request.objective.trim().replace(/\s+/g, " "),
    files: [...new Set((request.files ?? []).map(canonicalPath))].sort(),
    hypothesis: request.hypothesis?.trim().replace(/\s+/g, " ") ?? null,
  })).digest("hex");
}

export function normalizeDevelopmentBuilderResult(
  request: BuilderRequest,
  result: RawDevelopmentBuilderResult,
  builder: { builderId: string; kind: DevelopmentBuilderKind },
): NormalizedDevelopmentBuilderResult {
  if (result.requestedAuthority?.length) throw new Error("Builder output requested forbidden authority");
  if (!result.ok) return { ok: false, summary: result.summary, blocker: result.blocker, evidence: result.evidence };
  const declared = new Set((request.files ?? []).map(canonicalPath));
  const changedPaths = [...new Set((result.changedPaths ?? []).map(canonicalPath))].sort();
  if (declared.size && changedPaths.some((path) => !declared.has(path))) {
    throw new Error("Builder changed path outside declared scope");
  }
  if (!/^[a-f0-9]{64}$/.test(result.patchDigest ?? "")) throw new Error("Builder patch digest is required");
  const candidateRevision = result.candidateRevision ?? createHash("sha256").update(`candidate\0${request.baseRevision ?? "unbound"}\0${result.patchDigest}`).digest("hex");
  const artifactDigest = result.artifactDigest ?? createHash("sha256").update(`artifact\0${result.patchDigest}`).digest("hex");
  const artifactRef = result.artifactRef ?? `sha256:${artifactDigest}`;
  if (!/^[a-f0-9]{40,64}$/.test(candidateRevision)) throw new Error("Builder candidate revision is invalid");
  if (!/^[a-f0-9]{64}$/.test(artifactDigest) || artifactRef !== `sha256:${artifactDigest}`) throw new Error("Builder artifact reference is invalid");
  return {
    ok: true,
    summary: result.summary,
    evidence: result.evidence,
    changeSet: {
      goalId: request.goalId,
      attemptId: request.attemptId,
      strategyId: request.strategyId,
      baseRevision: request.baseRevision ?? null,
      builderId: builder.builderId,
      builderKind: builder.kind,
      changedPaths,
      patchDigest: result.patchDigest!,
      candidateRevision,
      artifactDigest,
      artifactRef,
      tddPhase: result.tddPhase,
      tddEvidenceDigest: result.tddEvidenceDigest,
      releaseAuthority: false,
    },
  };
}
