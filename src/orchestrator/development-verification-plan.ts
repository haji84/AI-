export type DevelopmentVerificationCheck =
  | "lint"
  | "typecheck"
  | "unit"
  | "integration"
  | "security"
  | "build"
  | "visual"
  | "windows"
  | "macos"
  | "physical-iphone";

export interface DevelopmentVerificationPlan {
  builderId: string;
  sourceRevision: string;
  artifactDigest: string;
  changedPaths: string[];
  requiredChecks: DevelopmentVerificationCheck[];
}

export interface DevelopmentVerificationEvidence {
  check: DevelopmentVerificationCheck;
  verifierId: string;
  sourceRevision: string;
  artifactDigest: string;
  status: "passed" | "failed" | "inconclusive";
  recordedAt: string;
}

const BASE_CHECKS: DevelopmentVerificationCheck[] = [
  "lint",
  "typecheck",
  "unit",
  "integration",
  "security",
  "build",
];

function includesPath(paths: string[], pattern: RegExp): boolean {
  return paths.some((path) => pattern.test(path.replaceAll("\\", "/")));
}

export function createDevelopmentVerificationPlan(input: {
  builderId: string;
  sourceRevision: string;
  artifactDigest: string;
  changedPaths: string[];
}): DevelopmentVerificationPlan {
  if (!input.builderId.trim()) throw new Error("development Builder identity is required");
  if (!/^[a-f0-9]{40,64}$/.test(input.sourceRevision)) throw new Error("invalid verification source revision");
  if (!/^[a-f0-9]{64}$/.test(input.artifactDigest)) throw new Error("invalid verification artifact digest");
  if (!input.changedPaths.length) throw new Error("verification changed paths are required");

  const requiredChecks = [...BASE_CHECKS];
  if (includesPath(input.changedPaths, /(?:^|\/)(?:app|ui|components?)\/|\.(?:tsx|jsx|css)$/i)) requiredChecks.push("visual");
  if (includesPath(input.changedPaths, /(?:^|\/)(?:windows)(?:\/|$)|\.ps1$/i)) requiredChecks.push("windows");
  if (includesPath(input.changedPaths, /(?:^|\/)(?:ios|macos)(?:\/|$)|\.swift$/i)) requiredChecks.push("macos");
  if (includesPath(input.changedPaths, /(?:^|\/)ios(?:\/|$)|iphone/i)) requiredChecks.push("physical-iphone");

  return {
    builderId: input.builderId,
    sourceRevision: input.sourceRevision,
    artifactDigest: input.artifactDigest,
    changedPaths: [...new Set(input.changedPaths)].sort(),
    requiredChecks,
  };
}

export function evaluateDevelopmentVerification(
  plan: DevelopmentVerificationPlan,
  evidence: DevelopmentVerificationEvidence[],
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const check of plan.requiredChecks) {
    const item = evidence.find((candidate) => candidate.check === check);
    if (!item) {
      reasons.push(`missing_evidence:${check}`);
      continue;
    }
    if (item.verifierId === plan.builderId) reasons.push(`builder_verifier_not_independent:${check}`);
    if (item.sourceRevision !== plan.sourceRevision) reasons.push(`stale_revision:${check}`);
    if (item.artifactDigest !== plan.artifactDigest) reasons.push(`artifact_mismatch:${check}`);
    if (item.status !== "passed") reasons.push(`check_not_passed:${check}`);
    if (!Number.isFinite(Date.parse(item.recordedAt))) reasons.push(`invalid_evidence_timestamp:${check}`);
  }
  return { passed: reasons.length === 0, reasons };
}
