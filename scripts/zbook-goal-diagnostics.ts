import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { goalFailureCode } from "./zbook-goal-failure-code.ts";

if (process.platform !== "win32" || !process.env.LOCALAPPDATA) throw Error("ZBook owner-local diagnostic only");
const dbPath = join(process.env.LOCALAPPDATA, "GAIWorker", "goal-1218-bridge-state", "compass.sqlite");
const goalId = "goal-2945730779960412";
const knownBlockers = new Set([
  "http_code_builder_error", "http_code_builder_failed", "http_code_builder_unreachable",
  "real_builder_capability_unavailable", "builder_contract_incomplete",
  "worker_code_builder_failed", "worker_code_builder_unavailable",
  "development_verifier_unavailable", "development_verifier_unreachable",
  "github_write_unavailable", "local_runtime_required", "spec_sync_state_invalid",
]);
const db = new CompassStore(dbPath);
try {
  const run = await new CompassWorkRunStore(db).getByGoal(goalId);
  const state = await new CompassWorkStateStoreAdapter(db).get(goalId);
  const failedChecks = state?.verificationResults.filter(item => item.passed !== true && item.waived !== true) ?? [];
  const recentHistory = db.getHistory(20);
  const codes = [...new Set([
    ...(state?.blockers ?? []).map(goalFailureCode),
    ...failedChecks.map(item => goalFailureCode({ note: item.note, evidence: item.evidence })),
    ...(state?.nextAction ? [goalFailureCode(state.nextAction)] : []),
  ])];
  const report = {
    goalId, workRunPhase: run?.phase ?? null, workStateStatus: state?.status ?? null,
    remainingChecks: state?.definitionOfDone.filter(item => !state.verificationResults.some(result => result.itemId === item.id && (result.passed || result.waived))).length ?? null,
    failedCheckIds: failedChecks.map(item => item.itemId).slice(0, 20),
    failureCodes: codes,
    knownBlockerIds: state?.blockers.filter(value => knownBlockers.has(value)) ?? [],
    recentFailureCodes: [...new Set(recentHistory.map(entry => goalFailureCode(entry.summary)))].filter(code => code !== "UNCLASSIFIED_BLOCKER"),
    blockerCount: state?.blockers.length ?? null,
  };
  const directory = resolve(".gai-results");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "goal-1218-bridge-diagnostics.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
} finally { db.close(); }
