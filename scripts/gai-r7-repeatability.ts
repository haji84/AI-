import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildR7StatisticsEvidence } from "../src/gai/research-stage-evidence.ts";
import { comparePairedBinary, repeatRunVariance, wilsonInterval } from "../src/gai/research-statistics.ts";

interface CaseResult { id: string; split: "train" | "heldout"; passed: boolean; additionalApiCost: number; }
interface Report {
  runMode: string; total: number; passed: number; successRate: number; heldoutTotal: number; heldoutSuccessRate: number;
  additionalApiCost: number; suiteSha256: string; completedAt: string; results: CaseResult[];
}

const root = process.cwd();
const referenceDir = path.resolve(root, ".gai-reference");
const resultsDir = path.resolve(root, ".gai-results");
const findReport = async (dir: string): Promise<string> => {
  const names = (await readdir(dir)).filter((name) => name.startsWith("r6-baseline-report-") && name.endsWith(".json"));
  if (names.length !== 1) throw new Error(`Expected exactly one R6 report in ${dir}; found ${names.length}`);
  return path.join(dir, names[0]);
};
const beforePath = await findReport(referenceDir);
const afterPath = await findReport(resultsDir);
const before = JSON.parse(await readFile(beforePath, "utf8")) as Report;
const after = JSON.parse(await readFile(afterPath, "utf8")) as Report;
if (before.runMode !== "REAL_SELF_HOSTED_LOCAL_MODEL" || after.runMode !== "REAL_SELF_HOSTED_LOCAL_MODEL") throw new Error("R7 requires two real self-hosted local-model runs");
if (before.suiteSha256 !== after.suiteSha256) throw new Error("R7 paired comparison requires identical frozen suite hashes");
if (before.total < 100 || after.total !== before.total) throw new Error("R7 requires matching >=100-case runs");
if (before.additionalApiCost !== 0 || after.additionalApiCost !== 0) throw new Error("R7 requires zero additional pay-as-you-go API cost");
if (before.results.some((item) => item.additionalApiCost !== 0) || after.results.some((item) => item.additionalApiCost !== 0)) throw new Error("R7 per-case additional API cost must remain zero");

const beforeById = new Map(before.results.map((item) => [item.id, item]));
const paired = after.results.map((item) => {
  const first = beforeById.get(item.id);
  if (!first) throw new Error(`R7 missing paired case ${item.id}`);
  return { id: item.id, before: first.passed, after: item.passed };
});
const heldoutPaired = paired.filter((item) => beforeById.get(item.id)?.split === "heldout");
const overallComparison = comparePairedBinary(paired);
const heldoutComparison = comparePairedBinary(heldoutPaired);
const beforeInterval = wilsonInterval(before.passed, before.total);
const afterInterval = wilsonInterval(after.passed, after.total);
const variance = repeatRunVariance([before.successRate, after.successRate]);
const heldoutVariance = repeatRunVariance([before.heldoutSuccessRate, after.heldoutSuccessRate]);
const intervalWidth = afterInterval.upper - afterInterval.lower;

const report = {
  schemaVersion: 1,
  suiteSha256: before.suiteSha256,
  runCount: 2,
  sampleSize: after.total,
  heldoutSampleSize: after.heldoutTotal,
  before: { successRate: before.successRate, heldoutSuccessRate: before.heldoutSuccessRate, interval: beforeInterval, completedAt: before.completedAt },
  after: { successRate: after.successRate, heldoutSuccessRate: after.heldoutSuccessRate, interval: afterInterval, completedAt: after.completedAt },
  paired: overallComparison,
  heldoutPaired: heldoutComparison,
  repeatRunVariance: variance,
  heldoutRepeatRunVariance: heldoutVariance,
  additionalApiCost: 0,
  generatedAt: new Date().toISOString(),
};
await mkdir(resultsDir, { recursive: true });
const reportPath = path.join(resultsDir, "r7-repeatability-report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const runId = `zbook-${String(after.completedAt).replace(/[^0-9A-Za-z]/g, "")}`;
const built = buildR7StatisticsEvidence({
  runId,
  source: reportPath,
  collectedAt: after.completedAt,
  sampleSize: after.total,
  repeatRuns: 2,
  confidenceIntervalWidth: intervalWidth,
  pairedComparison: true,
});
if (!built.accepted) throw new Error(`R7 evidence rejected: ${built.reasons.join("; ")}`);
await writeFile(path.join(resultsDir, "research-evidence.json"), `${JSON.stringify(built.evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ accepted: true, sampleSize: after.total, heldoutSampleSize: after.heldoutTotal, pairedDelta: overallComparison.delta, heldoutDelta: heldoutComparison.delta, standardDeviation: variance.standardDeviation, reportPath }, null, 2));
