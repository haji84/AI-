import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transferFamilies, suiteMeta } from '../benchmarks/internal/r8_transfer/suite.mjs';

const endpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT || '';
const model = process.env.GAI_LOCAL_MODEL_NAME || '';
const realRun = process.argv.includes('--real');
const outDir = path.resolve('.gai-results');
fs.mkdirSync(outDir, { recursive: true });
if (!realRun || !process.env.RUNNER_NAME || !endpoint || !model) throw new Error('R8 requires a real self-hosted runner with local model endpoint and model name');

const normalize = (value) => String(value).trim().replace(/\s+/g, ' ').toLowerCase();

async function ask(prompt) {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = await response.json();
  return String(body.response ?? '').trim();
}

const results = [];
for (const family of transferFamilies) {
  const memoryExamples = family.train.slice(0, 4);
  const trainFingerprints = new Set(family.train.map((item) => item.fingerprint));
  if (family.heldout.some((item) => trainFingerprints.has(item.fingerprint))) throw new Error(`heldout leakage detected in family ${family.id}`);
  const memoryText = memoryExamples.map((item) => `input=${item.input} -> output=${item.output}`).join('\n');

  for (const item of family.heldout) {
    const zeroPrompt = `You are given opaque transformation family '${family.id}'. No examples are available. Transform input=${item.input}. Return only the output.`;
    const memoryPrompt = `Learn the opaque transformation family '${family.id}' only from these TRAIN examples:\n${memoryText}\nNow transfer the learned rule to NEW input=${item.input}. Return only the output.`;
    console.log(`[R8] START ${item.id}`);
    let zeroOutput = '';
    let memoryOutput = '';
    let zeroError = null;
    let memoryError = null;
    const started = Date.now();
    try { zeroOutput = await ask(zeroPrompt); } catch (error) { zeroError = error instanceof Error ? error.message : String(error); }
    try { memoryOutput = await ask(memoryPrompt); } catch (error) { memoryError = error instanceof Error ? error.message : String(error); }
    const zeroPassed = !zeroError && normalize(zeroOutput) === normalize(item.output);
    const memoryPassed = !memoryError && normalize(memoryOutput) === normalize(item.output);
    const result = {
      id: item.id,
      family: family.id,
      expected: item.output,
      zeroShot: { output: zeroOutput, passed: zeroPassed, error: zeroError },
      memoryAssisted: { output: memoryOutput, passed: memoryPassed, error: memoryError },
      transferDelta: Number(memoryPassed) - Number(zeroPassed),
      durationMs: Date.now() - started,
      additionalApiCost: 0,
    };
    results.push(result);
    console.log(`[R8] DONE ${results.length}/${transferFamilies.reduce((n, f) => n + f.heldout.length, 0)} id=${item.id} zero=${zeroPassed} memory=${memoryPassed} delta=${result.transferDelta}`);
  }
}

const transferTasks = results.length;
const heldoutTasks = results.length;
const zeroShotRate = results.filter((item) => item.zeroShot.passed).length / transferTasks;
const memoryAssistedRate = results.filter((item) => item.memoryAssisted.passed).length / transferTasks;
const meanTransfer = results.reduce((sum, item) => sum + item.transferDelta, 0) / transferTasks;
const negativeTransferRate = results.filter((item) => item.zeroShot.passed && !item.memoryAssisted.passed).length / transferTasks;
const completedAt = new Date().toISOString();
const runId = `${process.env.GITHUB_RUN_ID || 'local'}-${Date.now()}`;
const report = {
  schemaVersion: 1,
  suiteId: suiteMeta.suiteId,
  suiteVersion: suiteMeta.version,
  runMode: 'REAL_SELF_HOSTED_LOCAL_MODEL',
  worker: { runnerName: process.env.RUNNER_NAME, platform: process.platform, arch: os.arch(), hostname: os.hostname() },
  model,
  transferTasks,
  heldoutTasks,
  zeroShotRate,
  memoryAssistedRate,
  meanTransfer,
  negativeTransferRate,
  heldoutLeakageCount: 0,
  additionalApiCost: 0,
  results,
  completedAt,
};
const common = {
  stage: 'R8',
  verified: true,
  source: `r8-memory-transfer-${runId}`,
  collectedAt: completedAt,
  metrics: { transferTasks, heldoutTasks, zeroShotRate, memoryAssistedRate, meanTransfer, negativeTransferRate, heldoutLeakageCount: 0, additionalApiCost: 0 },
};
const evidence = [
  { ...common, id: `R8-memory-${runId}`, kind: 'memory-transfer' },
  { ...common, id: `R8-heldout-${runId}`, kind: 'heldout-evaluation' },
];
fs.writeFileSync(path.join(outDir, 'r8-memory-transfer-report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, 'research-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ transferTasks, zeroShotRate, memoryAssistedRate, meanTransfer, negativeTransferRate, additionalApiCost: 0 }, null, 2));
