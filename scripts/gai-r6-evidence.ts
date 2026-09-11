import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildR6BenchmarkEvidence } from "../src/gai/research-stage-evidence.ts";

const outDir = path.resolve(".gai-results");
const files = await readdir(outDir);
const reportName = files.find((name) => name.startsWith("r6-baseline-report-") && name.endsWith(".json"));
if (!reportName) throw new Error("R6 baseline report not found");
const reportPath = path.join(outDir, reportName);
const report = JSON.parse(await readFile(reportPath, "utf8"));
if (report.runMode !== "REAL_SELF_HOSTED_LOCAL_MODEL") throw new Error("R6 evidence requires a real self-hosted local-model run");
if (report.additionalApiCost !== 0) throw new Error("R6 aggregate additional API cost must be zero");
if (!Array.isArray(report.results) || report.results.length < 100) throw new Error("R6 report is missing real per-case results");
if (report.results.some((item: { additionalApiCost?: number }) => item.additionalApiCost !== 0)) throw new Error("R6 per-case additional API cost must remain zero");

const runId = `${report.worker?.id ?? "worker"}-${String(report.completedAt ?? Date.now()).replace(/[^0-9A-Za-z]/g, "")}`;
const built = buildR6BenchmarkEvidence({
  runId,
  source: reportPath,
  collectedAt: report.completedAt ?? new Date().toISOString(),
  runMode: report.runMode,
  total: report.total,
  heldoutTotal: report.heldoutTotal,
  successRate: report.successRate,
  heldoutSuccessRate: report.heldoutSuccessRate,
  suiteSha256: report.suiteSha256,
});
if (!built.accepted) throw new Error(`R6 evidence rejected: ${built.reasons.join("; ")}`);
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "research-evidence.json"), `${JSON.stringify(built.evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ accepted: true, evidenceCount: built.evidence.length, kinds: built.evidence.map((item) => item.kind), reportPath }, null, 2));
