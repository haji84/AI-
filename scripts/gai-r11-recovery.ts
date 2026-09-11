import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { buildR11RecoveryEvidence } from "../src/gai/research-stage-evidence.ts";

const outDir = path.resolve(".gai-results");
const checkpointPath = path.join(outDir, "r11-recovery-checkpoint.json");
const reportPath = path.join(outDir, "r11-recovery-report.json");
const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8) ?? "full";
const tasks = Array.from({ length: 12 }, (_, index) => ({ id: `r11-heldout-${String(index + 1).padStart(2, "0")}`, seed: 31 + index * 7 }));
const injectedFailureSteps = new Set([3, 9]);
await mkdir(outDir, { recursive: true });

const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const solve = (seed: number, step: number) => ((seed * 17) + (step * step) + 13) % 1009;
const prefixDigest = (results: CheckpointItem[], count = results.length) => digest(results.slice(0, count).map((item) => ({ id: item.id, output: item.output, verified: item.verified, hash: item.hash })));

interface CheckpointItem { id: string; step: number; output: number; expected: number; verified: boolean; hash: string; }
interface State { schemaVersion: 1; nextIndex: number; injectedFailures: number; retries: number; phase1PrefixHash: string | null; results: CheckpointItem[]; }
let state: State = { schemaVersion: 1, nextIndex: 0, injectedFailures: 0, retries: 0, phase1PrefixHash: null, results: [] };

if (phase === "1") await rm(checkpointPath, { force: true });
if (phase === "2") {
  state = JSON.parse(await readFile(checkpointPath, "utf8")) as State;
  if (state.nextIndex !== 6) throw new Error(`R11 phase 2 expected nextIndex=6; got ${state.nextIndex}`);
  if (!state.phase1PrefixHash) throw new Error("R11 phase 2 checkpoint is missing phase1PrefixHash");
  const recomputed = prefixDigest(state.results, 6);
  if (recomputed !== state.phase1PrefixHash) throw new Error("R11 verified prefix hash mismatch before resume");
}

const endExclusive = phase === "1" ? 6 : tasks.length;
for (let index = state.nextIndex; index < endExclusive; index += 1) {
  const task = tasks[index];
  const step = index + 1;
  let injected = false;
  let verified = false;
  let output = Number.NaN;
  const expected = solve(task.seed, step);
  for (let attempt = 0; attempt < 3 && !verified; attempt += 1) {
    try {
      if (!injected && injectedFailureSteps.has(step)) {
        injected = true;
        state.injectedFailures += 1;
        throw new Error("INJECTED_RECOVERY_FAILURE");
      }
      output = solve(task.seed, step);
      verified = output === expected;
      if (!verified) throw new Error("verification mismatch");
    } catch {
      if (attempt < 2) state.retries += 1;
    }
  }
  if (!verified) throw new Error(`R11 failed to verify ${task.id}`);
  const item: CheckpointItem = { id: task.id, step, output, expected, verified, hash: digest({ id: task.id, output, expected }) };
  state.results.push(item);
  state.nextIndex = index + 1;
  await writeFile(checkpointPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

if (phase === "1") {
  state.phase1PrefixHash = prefixDigest(state.results, 6);
  await writeFile(checkpointPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ phase: 1, completed: state.results.length, nextIndex: state.nextIndex, injectedFailures: state.injectedFailures, phase1PrefixHash: state.phase1PrefixHash }, null, 2));
  process.exit(0);
}

const finalPrefixHash = prefixDigest(state.results, 6);
const verifiedPrefixRetained = state.results.length >= 6 && state.results.slice(0, 6).every((item) => item.verified) && Boolean(state.phase1PrefixHash) && finalPrefixHash === state.phase1PrefixHash;
const heldoutTasks = state.results.length;
const runId = `r11-${Date.now()}`;
const built = buildR11RecoveryEvidence({
  runId,
  source: "ci:checkpoint-resume-fault-injection",
  collectedAt: new Date().toISOString(),
  injectedFailures: state.injectedFailures,
  resumedFromCheckpoint: phase === "2",
  heldoutTasks,
  verifiedPrefixRetained,
});
if (!built.accepted) throw new Error(`R11 evidence rejected: ${built.reasons.join("; ")}`);
const report = { schemaVersion: 1, runId, totalTasks: tasks.length, heldoutTasks, injectedFailures: state.injectedFailures, retries: state.retries, resumedFromCheckpoint: phase === "2", verifiedPrefixRetained, phase1PrefixHash: state.phase1PrefixHash, finalPrefixHash, results: state.results, completedAt: new Date().toISOString() };
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(outDir, "research-evidence.json"), `${JSON.stringify(built.evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));