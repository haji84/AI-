import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ResearchEvidence } from "../src/gai/research-ops-program.ts";

interface BaselineResult {
  id: string;
  category: string;
  split: "train" | "heldout";
  passed: boolean;
  durationMs: number;
  error: string | null;
  humanInterventions: number;
  additionalApiCost: number;
}

interface BaselineReport {
  suiteId: string;
  suiteVersion: string;
  suiteSha256: string;
  runMode: string;
  model: string;
  total: number;
  passed: number;
  successRate: number;
  heldoutTotal: number;
  heldoutSuccessRate: number;
  humanInterventionsPerTask: number;
  additionalApiCost: number;
  completedAt: string;
  worker: { id: string; runnerName?: string | null; platform: string; arch: string; hostname: string };
  results: BaselineResult[];
}

const outDir = resolve(".gai-results");
await mkdir(outDir, { recursive: true });
const files = (await readdir(outDir)).filter((name) => name.startsWith("baseline-report-") && name.endsWith(".json"));
if (files.length === 0) throw new Error("No baseline-report-*.json found in .gai-results");

const reports = await Promise.all(files.map(async (name) => ({ name, report: JSON.parse(await readFile(join(outDir, name), "utf8")) as BaselineReport })));
const selected = reports.sort((a, b) => Date.parse(b.report.completedAt) - Date.parse(a.report.completedAt))[0];
const report = selected.report;
if (report.runMode !== "REAL_SELF_HOSTED_LOCAL_MODEL") throw new Error(`R1 evidence requires a real run; got ${report.runMode}`);
if (report.total < 100 || report.results.length < 100) throw new Error(`R1 requires >=100 real cases; got ${report.total}`);
if (report.heldoutTotal <= 0) throw new Error("R1 requires heldout cases");

const failures = report.results.filter((item) => !item.passed);
const failureByCategory = Object.fromEntries(
  [...new Set(report.results.map((item) => item.category))].map((category) => {
    const categoryResults = report.results.filter((item) => item.category === category);
    const categoryFailures = categoryResults.filter((item) => !item.passed);
    return [category, {
      total: categoryResults.length,
      failures: categoryFailures.length,
      failureRate: categoryResults.length ? categoryFailures.length / categoryResults.length : 0,
    }];
  }),
);
const runtimeErrors = failures.filter((item) => Boolean(item.error));
const verificationFailures = failures.filter((item) => !item.error);
const slowest = [...report.results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10).map((item) => ({ id: item.id, category: item.category, durationMs: item.durationMs, passed: item.passed }));

const taxonomy = {
  schemaVersion: 1,
  source: selected.name,
  total: report.total,
  failures: failures.length,
  runtimeErrors: runtimeErrors.length,
  verificationFailures: verificationFailures.length,
  byCategory: failureByCategory,
  slowest,
  generatedAt: new Date().toISOString(),
};

const weakestCategories = Object.entries(failureByCategory)
  .sort(([, a], [, b]) => b.failureRate - a.failureRate)
  .slice(0, 3)
  .map(([category, value]) => ({ category, ...value }));
const gapSnapshot = {
  schemaVersion: 1,
  source: selected.name,
  baselineSuccessRate: report.successRate,
  heldoutSuccessRate: report.heldoutSuccessRate,
  humanInterventionsPerTask: report.humanInterventionsPerTask,
  additionalApiCost: report.additionalApiCost,
  weakestCategories,
  externalBenchmarkEvidencePresent: false,
  longHorizonEvidencePresent: false,
  independentValidationPresent: false,
  agiClaimAllowed: false,
  verdict: "Internal baseline evidence only; insufficient evidence for an AGI claim.",
  generatedAt: new Date().toISOString(),
};

const common = {
  stage: "R1" as const,
  verified: true,
  source: selected.name,
  collectedAt: report.completedAt,
};
const evidence: ResearchEvidence[] = [
  {
    ...common,
    id: `R1-internal-baseline-${report.suiteSha256.slice(0, 12)}`,
    kind: "internal-baseline",
    metrics: { total: report.total, passed: report.passed, successRate: report.successRate, model: report.model, worker: report.worker.id },
  },
  {
    ...common,
    id: `R1-heldout-${report.suiteSha256.slice(0, 12)}`,
    kind: "heldout-evaluation",
    metrics: { heldoutTotal: report.heldoutTotal, heldoutSuccessRate: report.heldoutSuccessRate },
  },
  {
    ...common,
    id: `R1-failure-taxonomy-${report.suiteSha256.slice(0, 12)}`,
    kind: "failure-taxonomy",
    metrics: { failures: failures.length, runtimeErrors: runtimeErrors.length, verificationFailures: verificationFailures.length },
  },
  {
    ...common,
    id: `R1-agi-gap-${report.suiteSha256.slice(0, 12)}`,
    kind: "agi-gap-review",
    metrics: { baselineSuccessRate: report.successRate, heldoutSuccessRate: report.heldoutSuccessRate, agiClaimAllowed: false },
  },
  {
    ...common,
    id: `R1-cost-${report.suiteSha256.slice(0, 12)}`,
    kind: "cost-regression",
    verified: report.additionalApiCost === 0 && report.results.every((item) => item.additionalApiCost === 0),
    metrics: { additionalApiCost: report.additionalApiCost },
    notes: "Verified only when aggregate and every per-case additional API cost are zero.",
  },
];

await writeFile(join(outDir, "r1-failure-taxonomy.json"), JSON.stringify(taxonomy, null, 2));
await writeFile(join(outDir, "r1-agi-gap-snapshot.json"), JSON.stringify(gapSnapshot, null, 2));
await writeFile(join(outDir, "research-evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({
  source: selected.name,
  evidenceKinds: evidence.map((item) => `${item.kind}:${item.verified}`),
  remainingR1Evidence: ["safety-regression"],
  taxonomyPath: ".gai-results/r1-failure-taxonomy.json",
  gapPath: ".gai-results/r1-agi-gap-snapshot.json",
  evidencePath: ".gai-results/research-evidence.json",
}, null, 2));
