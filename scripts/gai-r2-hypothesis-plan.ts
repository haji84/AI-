import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { proposeResearchHypotheses, type FailureSignal } from "../src/gai/research-loop.ts";

interface FailureTaxonomy {
  total: number;
  failures: number;
  runtimeErrors: number;
  verificationFailures: number;
  byCategory: Record<string, { total: number; failures: number; failureRate: number }>;
  slowest: Array<{ id: string; category: string; durationMs: number; passed: boolean }>;
  generatedAt: string;
}

const outDir = path.resolve(".gai-results");
const taxonomyPath = path.join(outDir, "r1-failure-taxonomy.json");
const gapPath = path.join(outDir, "r1-agi-gap-snapshot.json");
const taxonomy = JSON.parse(await readFile(taxonomyPath, "utf8")) as FailureTaxonomy;
const gap = JSON.parse(await readFile(gapPath, "utf8"));

const categoryToBottleneck = (category: string): FailureSignal["bottleneck"] => {
  const name = category.toLowerCase();
  if (name.includes("memory") || name.includes("transfer")) return "memory";
  if (name.includes("planning") || name.includes("route")) return "planner";
  if (name.includes("verification")) return "world-model";
  if (name.includes("coding")) return "tooling";
  return "model-reasoning";
};

const signals: FailureSignal[] = Object.entries(taxonomy.byCategory)
  .filter(([, value]) => value.failures > 0)
  .flatMap(([category, value]) => Array.from({ length: value.failures }, (_, index) => ({
    taskId: `${category}-failure-${index + 1}`,
    actionId: category,
    bottleneck: categoryToBottleneck(category),
    severity: Math.max(0.5, Math.min(1, value.failureRate)),
    evidence: [`category=${category}`, `failureRate=${value.failureRate}`, `failures=${value.failures}/${value.total}`],
  })));

const hypotheses = proposeResearchHypotheses(signals).map((item) => ({
  ...item,
  experimentPolicy: {
    sandboxOnly: true,
    heldoutReadDuringCandidateDesign: false,
    minimumHeldoutGain: 0.01,
    maxAdditionalPaygApiCost: 0,
    rejectOnSafetyRegression: true,
    rejectOnHumanInterventionRegression: true,
  },
}));

const plan = {
  schemaVersion: 1,
  sourceTaxonomy: taxonomyPath,
  sourceGap: gapPath,
  baselineSuccessRate: gap.baselineSuccessRate,
  heldoutSuccessRate: gap.heldoutSuccessRate,
  failureCount: taxonomy.failures,
  hypotheses,
  rankedBottlenecks: hypotheses.map((item) => ({ bottleneck: item.bottleneck, evidenceCount: item.evidenceCount, expectedGain: item.expectedGain })),
  completionBlockedUntilMeasuredImprovement: true,
  generatedAt: new Date().toISOString(),
};

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "r2-hypothesis-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ hypotheses: hypotheses.length, rankedBottlenecks: plan.rankedBottlenecks, completionBlockedUntilMeasuredImprovement: true }, null, 2));
