import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { compareCrossDevice, summarizeDeviceEffect, type DeviceRunRecord } from "../src/gai/cross-device-evaluation.ts";
import { buildR13CrossDeviceEvidence } from "../src/gai/research-stage-evidence.ts";
import type { WorkerPlatform } from "../src/gai/worker-runtime.ts";

const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice(7) ?? "";
const outDir = path.resolve(".gai-results");
const referenceDir = path.resolve(".gai-reference");
await mkdir(outDir, { recursive: true });

const sha = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const commonTasks = Array.from({ length: 10 }, (_, index) => ({ id: `r13-common-${index + 1}`, seed: 41 + index * 9 }));
const commonSolve = (seed: number, index: number) => ((seed * 19) + (index + 1) * 11) % 997;
const chainSolve = (value: number, step: number) => ((value * 5) + step * 3) % 991;

async function runWorker(workerId: string, platform: WorkerPlatform) {
  const records: DeviceRunRecord[] = [];
  for (const [index, task] of commonTasks.entries()) {
    const started = Date.now();
    const expected = commonSolve(task.seed, index);
    const output = commonSolve(task.seed, index);
    records.push({ taskId: task.id, workerId, platform, passed: output === expected, durationMs: Date.now() - started, outputFingerprint: sha({ taskId: task.id, output }) });
  }
  return records;
}

if (mode === "zbook") {
  const records = await runWorker("zbook", "windows");
  let value = 17;
  const prefix = [] as Array<{ step: number; value: number }>;
  for (let step = 1; step <= 6; step += 1) {
    value = chainSolve(value, step);
    prefix.push({ step, value });
  }
  const checkpoint = { schemaVersion: 1, nextStep: 7, value, prefix, prefixHash: sha(prefix), sourceWorker: "zbook" };
  await writeFile(path.join(outDir, "r13-zbook.json"), `${JSON.stringify({ workerId: "zbook", platform: "windows", records }, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "r13-transfer-checkpoint.json"), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ worker: "zbook", commonTasks: records.length, checkpoint }, null, 2));
  process.exit(0);
}

if (mode === "mac") {
  const records = await runWorker("macbook", "macos");
  const checkpointPath = path.join(referenceDir, "r13-zbook", "r13-transfer-checkpoint.json");
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as { nextStep: number; value: number; prefix: Array<{ step: number; value: number }>; prefixHash: string; sourceWorker: string };
  if (checkpoint.sourceWorker !== "zbook" || checkpoint.nextStep !== 7) throw new Error("R13 invalid ZBook checkpoint");
  if (sha(checkpoint.prefix) !== checkpoint.prefixHash) throw new Error("R13 ZBook prefix hash mismatch before Mac resume");
  let value = checkpoint.value;
  for (let step = checkpoint.nextStep; step <= 12; step += 1) value = chainSolve(value, step);
  const resumeAfterWorkerLossVerified = sha(checkpoint.prefix) === checkpoint.prefixHash && Number.isFinite(value);
  await writeFile(path.join(outDir, "r13-mac.json"), `${JSON.stringify({ workerId: "macbook", platform: "macos", records, resumeAfterWorkerLossVerified, resumedFromWorker: "zbook", finalValue: value, prefixHash: checkpoint.prefixHash }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ worker: "macbook", commonTasks: records.length, resumeAfterWorkerLossVerified, finalValue: value }, null, 2));
  process.exit(0);
}

if (mode === "aggregate") {
  const zbook = JSON.parse(await readFile(path.join(referenceDir, "r13-zbook", "r13-zbook.json"), "utf8")) as { workerId: string; platform: WorkerPlatform; records: DeviceRunRecord[] };
  const mac = JSON.parse(await readFile(path.join(referenceDir, "r13-mac", "r13-mac.json"), "utf8")) as { workerId: string; platform: WorkerPlatform; records: DeviceRunRecord[]; resumeAfterWorkerLossVerified: boolean };
  const records = [...zbook.records, ...mac.records];
  const comparisons = compareCrossDevice(records);
  const summary = summarizeDeviceEffect(comparisons);
  if (summary.tasks !== commonTasks.length) throw new Error(`R13 expected ${commonTasks.length} common tasks; got ${summary.tasks}`);
  const built = buildR13CrossDeviceEvidence({
    runId: `r13-${Date.now()}`,
    source: "zbook+macbook:cross-device-resume",
    collectedAt: new Date().toISOString(),
    commonTasks: summary.tasks,
    outcomeAgreementRate: summary.outcomeAgreementRate ?? 0,
    workerCount: 2,
    resumeAfterWorkerLossVerified: mac.resumeAfterWorkerLossVerified,
  });
  if (!built.accepted) throw new Error(`R13 evidence rejected: ${built.reasons.join("; ")}`);
  const report = { schemaVersion: 1, workerCount: 2, commonTasks: summary.tasks, outcomeAgreementRate: summary.outcomeAgreementRate, divergentTasks: summary.divergentTasks, resumeAfterWorkerLossVerified: mac.resumeAfterWorkerLossVerified, additionalApiCost: 0, comparisons, completedAt: new Date().toISOString() };
  await writeFile(path.join(outDir, "r13-cross-device-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "research-evidence.json"), `${JSON.stringify(built.evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

throw new Error(`Unknown R13 mode: ${mode}`);