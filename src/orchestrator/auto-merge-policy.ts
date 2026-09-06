export interface AutoMergeCandidate {
  baseBranch: string;
  changedFiles: string[];
  lintPassed: boolean;
  testsPassed: boolean;
  buildPassed: boolean;
  draft?: boolean;
}

export interface AutoMergeDecision {
  eligible: boolean;
  reasons: string[];
}

const ALLOWED_PREFIXES = ["src/", "tests/", "docs/", "scripts/"];
const FORBIDDEN_EXACT = new Set([
  "AGENTS.md",
  "PROJECT_STATE.md",
  "ROADMAP.md",
  "package.json",
  "pnpm-lock.yaml",
]);

function isBoundedPath(path: string): boolean {
  if (FORBIDDEN_EXACT.has(path)) return false;
  if (path.startsWith(".github/")) return false;
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function evaluateAutoMergeEligibility(candidate: AutoMergeCandidate): AutoMergeDecision {
  const reasons: string[] = [];

  if (candidate.baseBranch !== "main") reasons.push("base_not_main");
  if (candidate.draft === true) reasons.push("draft_pr");
  if (candidate.changedFiles.length === 0) reasons.push("empty_patch");
  if (candidate.changedFiles.some((path) => !isBoundedPath(path))) reasons.push("unbounded_path");
  if (!candidate.lintPassed) reasons.push("lint_not_verified");
  if (!candidate.testsPassed) reasons.push("tests_not_verified");
  if (!candidate.buildPassed) reasons.push("build_not_verified");

  return { eligible: reasons.length === 0, reasons };
}
