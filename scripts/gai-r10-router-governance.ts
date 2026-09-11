import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { GovernedModelExecutor, createFunctionAdapter } from "../src/gai/model-execution.ts";
import { PersistentUsageLedger } from "../src/gai/usage-ledger.ts";
import { buildR10RouterEvidence } from "../src/gai/research-stage-evidence.ts";
import type { TaskProfile } from "../src/gai/types.ts";

const outDir = path.resolve(".gai-results");
await mkdir(outDir, { recursive: true });
const ledgerPath = path.join(outDir, "r10-usage-ledger.json");
await rm(ledgerPath, { force: true });
const ledger = new PersistentUsageLedger(ledgerPath);

const adapters = [
  createFunctionAdapter({ tier: "local", provider: "local-fixture", planIncluded: true, run: async (input) => `LOCAL:${input}` }),
  createFunctionAdapter({ tier: "sol", provider: "sol-plan", planIncluded: true, available: () => false, run: async (input) => `SOL:${input}` }),
  createFunctionAdapter({ tier: "astra", provider: "astra-paid-forbidden", planIncluded: false, available: () => true, run: async (input) => `ASTRA:${input}` }),
];
const executor = new GovernedModelExecutor(adapters, ledger);

const tasks: TaskProfile[] = [
  { id: "r10-local", description: "routine local classification", difficulty: 2, risk: "LOW" },
  { id: "r10-sol-fallback", description: "medium reasoning with Sol unavailable", difficulty: 6, risk: "LOW" },
  { id: "r10-astra-paid-refusal", description: "frontier reasoning with only paid Astra adapter", difficulty: 10, requiresFrontierReasoning: true, risk: "LOW" },
  { id: "r10-long-context", description: "long context task", difficulty: 4, requiresLongContext: true, risk: "MEDIUM" },
  { id: "r10-critical", description: "critical-risk task must remain local bounded", difficulty: 10, risk: "CRITICAL" },
];

const results = [];
for (const task of tasks) {
  const result = await executor.execute({ task, input: task.id, allowFrontierEscalation: true });
  results.push({ taskId: task.id, requestedTier: result.requestedTier, executedTier: result.executedTier, planIncluded: result.planIncluded, fallbackReason: result.fallbackReason ?? null, ok: result.ok });
}

const byId = new Map(results.map((item) => [item.taskId, item]));
const checks = {
  routineStayedLocal: byId.get("r10-local")?.executedTier === "local",
  solUnavailableFellBackLocal: byId.get("r10-sol-fallback")?.requestedTier === "sol" && byId.get("r10-sol-fallback")?.executedTier === "local",
  paidAstraWasNotExecuted: byId.get("r10-astra-paid-refusal")?.requestedTier === "astra" && byId.get("r10-astra-paid-refusal")?.executedTier === "local",
  longContextFellBackLocal: byId.get("r10-long-context")?.requestedTier === "sol" && byId.get("r10-long-context")?.executedTier === "local",
  criticalStayedBoundedLocal: byId.get("r10-critical")?.executedTier === "local",
};
if (Object.values(checks).some((value) => !value)) throw new Error(`R10 routing assertions failed: ${JSON.stringify(checks)}`);

let paidLedgerRejected = false;
try {
  await ledger.append({ id: "r10-paid-injection", taskId: "r10-paid-injection", requestedTier: "astra", executedTier: "astra", provider: "paid-api", planIncluded: false, additionalApiCost: 1, success: true, durationMs: 1 });
} catch {
  paidLedgerRejected = true;
}
if (!paidLedgerRejected) throw new Error("R10 failed: usage ledger accepted a paid API record");

const summary = await ledger.summary();
if (summary.additionalApiCost !== 0) throw new Error(`R10 failed: non-zero additional API cost ${summary.additionalApiCost}`);
const fallbackVerified = checks.solUnavailableFellBackLocal && checks.paidAstraWasNotExecuted && checks.longContextFellBackLocal;
const built = buildR10RouterEvidence({
  runId: `r10-${Date.now()}`,
  source: "ci:governed-model-executor",
  collectedAt: new Date().toISOString(),
  evaluatedTasks: tasks.length,
  fallbackVerified,
  safetyRegression: false,
  additionalApiCost: summary.additionalApiCost,
});
if (!built.accepted) throw new Error(`R10 evidence rejected: ${built.reasons.join("; ")}`);

const report = { schemaVersion: 1, tasks: results, checks: { ...checks, paidLedgerRejected }, usageSummary: summary, fallbackVerified, additionalApiCost: summary.additionalApiCost, completedAt: new Date().toISOString() };
await writeFile(path.join(outDir, "r10-router-governance-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(outDir, "research-evidence.json"), `${JSON.stringify(built.evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));