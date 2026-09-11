import type { ResearchEvidence, ResearchStageId } from "./research-ops-program.ts";

export type ExternalBenchmarkId = "arc-agi-3" | "swe-bench" | "osworld" | "memgym" | "custom-external";

export interface ExternalBenchmarkRun {
  id: string;
  benchmark: ExternalBenchmarkId;
  harnessRepository: string;
  harnessRevision: string;
  officialOrCompatibleHarness: boolean;
  model: string;
  runtime: string;
  taskCount: number;
  score: number;
  scoreName: string;
  rawArtifactSha256: string;
  completedAt: string;
  additionalApiCost: number;
  interactive?: boolean;
  independentEnvironment?: boolean;
  notes?: string;
}

export interface ExternalEvidenceDecision {
  accepted: boolean;
  reasons: string[];
  evidence: ResearchEvidence[];
}

const sha256 = /^[a-f0-9]{64}$/i;

export function validateExternalBenchmarkRun(
  run: ExternalBenchmarkRun,
  stage: Extract<ResearchStageId, "R3" | "R12" | "R19">,
): ExternalEvidenceDecision {
  const reasons: string[] = [];
  if (!run.officialOrCompatibleHarness) reasons.push("benchmark run did not use an official or explicitly compatible harness");
  if (!run.harnessRepository.startsWith("https://github.com/")) reasons.push("harness repository provenance is missing or unsupported");
  if (!run.harnessRevision.trim()) reasons.push("harness revision is missing");
  if (!Number.isInteger(run.taskCount) || run.taskCount <= 0) reasons.push("taskCount must be a positive integer");
  if (!Number.isFinite(run.score)) reasons.push("score must be finite");
  if (!run.scoreName.trim()) reasons.push("scoreName is missing");
  if (!sha256.test(run.rawArtifactSha256)) reasons.push("raw artifact SHA-256 is invalid");
  if (!Number.isFinite(Date.parse(run.completedAt))) reasons.push("completedAt is invalid");
  if (run.additionalApiCost !== 0) reasons.push("additional pay-as-you-go API cost must be zero");
  if (stage === "R12" && !run.interactive) reasons.push("R12 requires an interactive benchmark run");
  if (stage === "R19" && !run.independentEnvironment) reasons.push("R19 requires an independent replication environment");
  if (reasons.length) return { accepted: false, reasons, evidence: [] };

  const common = {
    stage,
    verified: true,
    source: `${run.harnessRepository}@${run.harnessRevision}`,
    collectedAt: run.completedAt,
    metrics: {
      benchmark: run.benchmark,
      model: run.model,
      runtime: run.runtime,
      taskCount: run.taskCount,
      score: run.score,
      scoreName: run.scoreName,
      rawArtifactSha256: run.rawArtifactSha256,
      additionalApiCost: run.additionalApiCost,
      interactive: Boolean(run.interactive),
      independentEnvironment: Boolean(run.independentEnvironment),
    },
    notes: run.notes,
  } satisfies Omit<ResearchEvidence, "id" | "kind">;

  const evidence: ResearchEvidence[] = [];
  if (stage === "R3" || stage === "R12" || stage === "R19") {
    evidence.push({ ...common, id: `${stage}-external-${run.benchmark}-${run.id}`, kind: "external-benchmark" });
  }
  evidence.push({ ...common, id: `${stage}-reproducibility-${run.benchmark}-${run.id}`, kind: "reproducibility" });
  if (stage === "R12") {
    evidence.push({ ...common, id: `${stage}-interactive-${run.benchmark}-${run.id}`, kind: "long-horizon" });
  }
  if (stage === "R19") {
    evidence.push({ ...common, id: `${stage}-replication-${run.benchmark}-${run.id}`, kind: "independent-replication" });
  }
  return { accepted: true, reasons: [], evidence };
}
