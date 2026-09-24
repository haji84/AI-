#!/usr/bin/env node
/** Actual-release, isolated local assessment. No production DB, Worker, network policy or model installation is changed. */
import { access, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cases = ["local-brain-copy", "no-model-copy", "unsupported-novel-goal"];
const required = name => { const value = process.env[name]?.trim(); if (!value || !isAbsolute(value)) throw Error(name + " must be an explicit absolute path"); return resolve(value); };
const releaseRoot = required("GORIQ_ACCEPTANCE_RELEASE_ROOT");
const outputRoot = required("GORIQ_ACCEPTANCE_OUTPUT_DIR");
const noModelWorker = process.argv.length === 3 && process.argv[2] === "--no-model-case";
const resumeCase = process.argv.length === 4 && process.argv[2] === "--resume-case" ? process.argv[3] : null;
if ((process.argv.length !== 2 && !resumeCase && !noModelWorker) || (resumeCase && !cases.slice(0, 2).includes(resumeCase))) throw Error("Unsupported acceptance arguments");
for (const path of [releaseRoot, dirname(outputRoot)]) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("A real directory is required: " + path);
}
const canonicalRelease = await realpath(releaseRoot);
const relativeOutput = relative(canonicalRelease, outputRoot);
if (!relativeOutput || (!isAbsolute(relativeOutput) && relativeOutput !== ".." && !relativeOutput.startsWith(".." + sep))) throw Error("Acceptance output must be outside the release");
const load = file => import(pathToFileURL(join(canonicalRelease, file)).href);
const [{ CompassStore }, { CognitiveService }, { CognitiveStateStore }, { configuredPrimaryBrain }] = await Promise.all([
  load("src/compass/store.ts"), load("src/gai/cognitive-service.ts"),
  load("src/gai/cognitive-state.ts"), load("src/gai/primary-brain.ts"),
]);
const partition = { tenantId: "local-acceptance", principalId: "owner-fixture" };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const options = (root, brain, intake = true) => ({ stateRoot: join(root, "cognition"), partition, environment: "isolated-local-acceptance", allowExternalAI: false,
  ...(brain ? { brain } : {}), ...(intake ? { materialIntake: { dataRoot: join(root, "data") } } : {}) });
const withoutModelEnvironment = () => {
  const env = { ...process.env }; delete env.GAI_LOCAL_MODEL_NAME; delete env.GAI_LOCAL_MODEL_ENDPOINT; return env;
};
const withNoModel = async fn => {
  const saved = { name: process.env.GAI_LOCAL_MODEL_NAME, endpoint: process.env.GAI_LOCAL_MODEL_ENDPOINT };
  delete process.env.GAI_LOCAL_MODEL_NAME; delete process.env.GAI_LOCAL_MODEL_ENDPOINT;
  try { return await fn(); } finally {
    if (saved.name === undefined) delete process.env.GAI_LOCAL_MODEL_NAME; else process.env.GAI_LOCAL_MODEL_NAME = saved.name;
    if (saved.endpoint === undefined) delete process.env.GAI_LOCAL_MODEL_ENDPOINT; else process.env.GAI_LOCAL_MODEL_ENDPOINT = saved.endpoint;
  }
};
if (noModelWorker && (process.env.GAI_LOCAL_MODEL_NAME !== undefined || process.env.GAI_LOCAL_MODEL_ENDPOINT !== undefined)) throw Error("No-model child inherited model configuration");
const state = async (root, goalId) => new CognitiveStateStore(join(root, "cognition"), partition).get(goalId);
const sourceCounts = snapshot => Object.fromEntries([...new Set((snapshot?.attempts ?? []).map(a => a.source))].map(source => [source, snapshot.attempts.filter(a => a.source === source).length]));
const noExternal = (snapshot, status) => snapshot?.external_ai_calls === 0 && status.externalAIEnabled === false &&
  !snapshot.attempts.some(a => a.source === "external-expert") && (status.metrics.externalAiCallsPerGoal === 0 || status.metrics.externalAiCallsPerGoal === null);

if (resumeCase) {
  const info = await lstat(outputRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Invalid retained acceptance directory");
  const root = join(outputRoot, resumeCase), input = JSON.parse(await readFile(join(root, "input-contract.json"), "utf8"));
  const before = await state(root, input.goalId);
  const beforeIds = before?.attempts.map(a => a.id) ?? [];
  const result = await withNoModel(async () => {
    const service = new CognitiveService(join(root, "compass.db"), options(root));
    const beforeStatus = await service.status();
    const report = await service.continue(input.goalId);
    const after = await state(root, input.goalId), status = await service.status();
    const output = await service.output(input.goalId, input.outputId);
    const expected = await readFile(join(root, "input.txt"));
    const matches = output.bytes.equals(expected) && digest(output.bytes) === input.expectedSha256;
    return { freshProcess: true, goalId: input.goalId, sameGoal: beforeStatus.goalId === input.goalId && status.goalId === input.goalId,
      report, attemptsBefore: beforeIds, attemptsAfter: after.attempts.map(a => a.id),
      duplicateActions: after.attempts.length - beforeIds.length, outputMatches: matches, externalAIAbsent: noExternal(after, status),
      passed: report.goalEvaluation?.achieved === true && matches && JSON.stringify(after.attempts.map(a => a.id)) === JSON.stringify(beforeIds) && noExternal(after, status) };
  });
  await json(join(root, "restart-check.json"), result);
  console.log(JSON.stringify({ case: resumeCase, restartPassed: result.passed }));
  if (!result.passed) process.exitCode = 1;
} else {
  // Exclusive creation: reruns need a fresh output directory. Existing data is never replaced or deleted.
  if (!noModelWorker) await mkdir(outputRoot, { mode: 0o700 });
  const startedAt = new Date().toISOString();
  const sourceFiles = ["src/gai/cognitive-service.ts", "src/gai/cognitive-core.ts", "src/gai/cognitive-state.ts",
    "src/gai/cognitive-learning.ts", "src/gai/cognitive-local-outcomes.ts", "src/gai/cognitive-material-intake.ts",
    "src/gai/primary-brain.ts", "src/orchestrator/compass-goal-execution-adapter.ts"];
  const sourceHashes = {};
  for (const file of sourceFiles) sourceHashes[file] = digest(await readFile(join(canonicalRelease, file)));
  const model = process.env.GAI_LOCAL_MODEL_NAME?.trim();
  if (!noModelWorker && !model) throw Error("GAI_LOCAL_MODEL_NAME must identify an already installed local model");
  const brain = noModelWorker ? null : configuredPrimaryBrain();
  if (!noModelWorker && !brain) throw Error("Local Primary Brain is unavailable");
  // The adapter validates the loopback origin; this separate bounded inventory never pulls a model.
  if (!noModelWorker) {
  const origin = new URL(process.env.GAI_LOCAL_MODEL_ENDPOINT?.trim() || "http://127.0.0.1:11434").origin;
  const response = await fetch(origin + "/api/tags", { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.body) throw Error("Installed-model inventory unavailable");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 262144) throw Error("Model inventory exceeds bound"); chunks.push(item.value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const inventory = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const installed = inventory.models?.some(item => item.name === model || item.model === model);
  if (!installed) throw Error("Requested local model is not already installed; no download attempted");
  await json(join(outputRoot, "assessment-contract.json"), { version: 1, startedAt, releaseRoot: canonicalRelease, sourceHashes,
    declaredSourceCommit: process.env.GORIQ_ACCEPTANCE_SOURCE_COMMIT || null, commitIndependentlyVerifiedByHarness: false,
    model, installedModelConfirmed: true, externalAIAllowed: false, productionStateAccessed: false,
    physicalTest: false, networkDisconnectedForTest: false, generalUnknownTaskClaim: false, purpose: "Measure bounded real runtime behavior and honest unsupported-goal limits" });
  }
  const results = [];
  for (const caseId of noModelWorker ? ["no-model-copy"] : cases) {
    if (caseId === "no-model-copy" && !noModelWorker) {
      try {
        const child = await exec(process.execPath, [fileURLToPath(import.meta.url), "--no-model-case"],
          { windowsHide: true, timeout: 120000, maxBuffer: 131072, env: withoutModelEnvironment() });
        await writeFile(join(outputRoot, "no-model-case-process.log"), child.stdout, { flag: "wx", mode: 0o600 });
        results.push(JSON.parse(await readFile(join(outputRoot, caseId, "result.json"), "utf8")));
      } catch {
        const saved = await readFile(join(outputRoot, caseId, "result.json"), "utf8").then(JSON.parse, () => null);
        results.push({ ...(saved || { caseId }), behaviorVerified: false, childProcessPassed: false });
      }
      continue;
    }
    const root = join(outputRoot, caseId);
    await mkdir(root); await mkdir(join(root, "data"));
    const known = caseId !== "unsupported-novel-goal", localModelEnabled = caseId !== "no-model-copy";
    const modelCalls = { attempted: 0, succeeded: 0, failed: 0, methods: {} };
    const countedBrain = {};
    for (const method of ["infer", "plan", "classify", "summarize", "hypothesize", "critique", "estimateConfidence"]) countedBrain[method] = async (...args) => {
      modelCalls.attempted++; modelCalls.methods[method] = (modelCalls.methods[method] || 0) + 1;
      try { const result = await brain[method](...args); modelCalls.succeeded++; return result; }
      catch (error) { modelCalls.failed++; throw error; }
    };
    const criteria = known ? ["The downloadable text file preserves the supplied UTF-8 text byte for byte"] :
      ["A JSON file contains three further terms and compared rule hypotheses for the novel sequence 2, 5, 10, 17"];
    const title = known ? "Preserve the supplied report as a downloadable local text file" :
      "Infer competing rules for the novel sequence 2, 5, 10, 17 and create a JSON result without a prewritten action contract";
    const db = new CompassStore(join(root, "compass.db"));
    try { db.setGoal({ title, successCriteria: criteria, constraints: ["No external AI", "No external network or device operations", "Only this isolated acceptance directory may be used"] }); }
    finally { db.close(); }
    const caseStarted = Date.now();
    let result;
    try {
      const perform = async () => {
        const service = new CognitiveService(join(root, "compass.db"), options(root, localModelEnabled ? countedBrain : undefined, known));
        const initial = await service.status();
        const text = "GORIQ local acceptance\nPreserve these exact bytes.\nValue: 42\n";
        let receipt;
        if (known) {
          await writeFile(join(root, "input.txt"), text, { flag: "wx", mode: 0o600 });
          receipt = await service.prepareMaterials({ goalId: initial.goalId, goalDigest: initial.goalDigest,
            materials: [{ format: "text", content: text, criteria: ["criterion-1"] }], mappingAcknowledged: true });
        }
        await json(join(root, "input-contract.json"), { caseId, goalId: initial.goalId, title, criteria,
          materialIntake: known, localModelEnabled, expectedSha256: known ? digest(Buffer.from(text)) : null, outputId: receipt?.outputs[0].id ?? null });
        const report = await service.continue(initial.goalId);
        const checkpoint = await state(root, initial.goalId), status = await service.status();
        let exactOutput = false, outputHash = null;
        if (known && report.goalEvaluation?.achieved === true) {
          const output = await service.output(initial.goalId, receipt.outputs[0].id);
          await writeFile(join(root, "verified-output.txt"), output.bytes, { flag: "wx", mode: 0o600 });
          exactOutput = output.bytes.equals(Buffer.from(text)); outputHash = digest(output.bytes);
        }
        await json(join(root, "checkpoint-after-run.json"), checkpoint);
        await json(join(root, "status-after-run.json"), status);
        const completed = report.goalEvaluation?.achieved === true && report.stopReason === "goal_complete";
        const unexpectedOutput = !known && await access(join(root, "data", "novel-result.json")).then(() => true, e => { if (e.code === "ENOENT") return false; throw e; });
        const honestBoundary = !known && !completed && !status.goalComplete && !unexpectedOutput &&
          checkpoint?.mode === "DEGRADED" && checkpoint.blockers.includes("no_untried_authorized_candidate");
        return { caseId, goalId: initial.goalId, elapsedMs: Date.now() - caseStarted, report, goalCompleted: completed,
          localModelEnabled, modelUnavailableChild: noModelWorker, modelCalls, usedLocalModel: checkpoint?.attempts.some(a => a.source === "local-model") === true,
          actionSources: sourceCounts(checkpoint), boundedHostTransform: known, exactOutput, outputHash, externalAIAbsent: noExternal(checkpoint, status),
          honestUnsupportedGoal: honestBoundary, goalNotSolved: !completed, restartRequired: known,
          behaviorVerified: noExternal(checkpoint, status) && (known ? completed && exactOutput : honestBoundary),
          limitations: known ? ["Host supplies supported transform and exact completion oracle", "Not arbitrary task synthesis"] :
            ["No trusted executable action contract is synthesized", "Observation is not completion"] };
      };
      result = localModelEnabled ? await perform() : await withNoModel(perform);
      if (known && result.behaviorVerified) {
        const restarted = await exec(process.execPath, [fileURLToPath(import.meta.url), "--resume-case", caseId],
          { windowsHide: true, timeout: 90000, maxBuffer: 131072, env: withoutModelEnvironment() });
        await writeFile(join(root, "restart-process.log"), restarted.stdout, { flag: "wx", mode: 0o600 });
        const check = JSON.parse(await readFile(join(root, "restart-check.json"), "utf8"));
        result.restartPassed = check.passed;
        result.behaviorVerified = result.behaviorVerified && check.passed;
      }
    } catch (error) {
      result = { caseId, elapsedMs: Date.now() - caseStarted, localModelEnabled, modelCalls,
        behaviorVerified: false, error: error instanceof Error ? error.message.slice(0, 1000) : "Unknown assessment failure" };
    }
    await json(join(root, "result.json"), result); results.push(result);
    console.log(JSON.stringify({ caseId, goalCompleted: result.goalCompleted ?? false, behaviorVerified: result.behaviorVerified, modelCalls: result.modelCalls, elapsedMs: result.elapsedMs }));
  }
  const summary = { startedAt, completedAt: new Date().toISOString(), releaseRoot: canonicalRelease, sourceHashes, model,
    results, cases: results.length, goalsCompleted: results.filter(r => r.goalCompleted).length,
    behaviorVerified: results.every(r => r.behaviorVerified), localModelContributed: results[0]?.usedLocalModel === true,
    allCasesExternalAIAbsent: results.every(r => r.externalAIAbsent === true),
    physicalTest: false, networkDisconnectedForTest: false, fullProductAcceptance: false, broadAutonomyBenchmark: false,
    interpretation: "Known host transforms and safe unsupported-goal reporting are distinct. Local model calls do not themselves prove reasoning quality." };
  if (!noModelWorker) await json(join(outputRoot, "summary.json"), summary);
  console.log(JSON.stringify({ summary: noModelWorker ? null : join(outputRoot, "summary.json"), behaviorVerified: summary.behaviorVerified, goalsCompleted: summary.goalsCompleted,
    cases: summary.cases, localModelContributed: summary.localModelContributed }));
  if (!summary.behaviorVerified) process.exitCode = 1;
}