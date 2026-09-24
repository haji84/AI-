import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { goalFailureCode } from "./zbook-goal-failure-code.ts";

if (process.platform !== "win32" || !process.env.LOCALAPPDATA) throw Error("ZBook owner-local diagnostic only");
const dbPath = join(process.env.LOCALAPPDATA, "GAIWorker", "goal-1218-bridge-state", "compass.sqlite");
const goalId = "goal-2945730779960412";
const db = new CompassStore(dbPath);
try {
  const run = await new CompassWorkRunStore(db).getByGoal(goalId);
  const state = await new CompassWorkStateStoreAdapter(db).get(goalId);
  const failedChecks = state?.verificationResults.filter(item => item.passed !== true && item.waived !== true) ?? [];
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
    blockerCount: state?.blockers.length ?? null,
  };
  const directory = resolve(".gai-results");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "goal-1218-bridge-diagnostics.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
} finally { db.close(); }
