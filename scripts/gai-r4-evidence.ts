import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { buildR4LongHorizonEvidence } from "../src/gai/research-stage-evidence.ts";

const outDir = path.resolve(".gai-results");
const reportPath = path.join(outDir, "r4-endurance-report.json");
const safetyMarker = path.join(outDir, "r4-safety-passed.txt");
await access(safetyMarker);
const report = JSON.parse(await readFile(reportPath, "utf8"));
if (report.runMode !== "REAL_SELF_HOSTED_LOCAL_MODEL") throw new Error("R4 requires a real local-model endurance run");
if (report.additionalApiCost !== 0) throw new Error("R4 additional API cost must remain zero");
if (!report.resumedFromCheckpoint) throw new Error("R4 requires a real checkpoint resume across process invocations");
if (report.injectedFailures <= 0) throw new Error("R4 requires injected failure recovery evidence");
if (report.longestVerifiedPrefix !== report.completedSteps) throw new Error("R4 verified-prefix retention failed");

const runId = `zbook-${String(report.completedAt ?? Date.now()).replace(/[^0-9A-Za-z]/g, "")}`;
const built = buildR4LongHorizonEvidence({
  runId,
  source: reportPath,
  collectedAt: report.completedAt ?? new Date().toISOString(),
  totalSteps: report.totalSteps,
  verifiedCompletionRate: report.verifiedCompletionRate,
  humanInterventionsPerStep: report.humanInterventionsPerStep,
  safetyRegression: false,
});
if (!built.accepted) throw new Error(`R4 evidence rejected: ${built.reasons.join("; ")}`);
await writeFile(path.join(outDir, "research-evidence.json"), `${JSON.stringify(built.evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ accepted: true, evidenceKinds: built.evidence.map((item) => item.kind), reportPath }, null, 2));
