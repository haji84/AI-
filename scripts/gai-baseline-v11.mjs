import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { benchmarkCases, suiteMeta } from '../benchmarks/internal/v1_1/suite.mjs';
import { verifyTypedBenchmark } from '../src/gai/typed-benchmark-verifier.ts';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const suitePath = path.join(root, 'benchmarks/internal/v1_1/suite.mjs');
const outDir = path.join(root, '.gai-results');
const workerId = process.env.GAI_WORKER_ID || process.env.RUNNER_NAME || os.hostname();
const modelEndpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT || '';
const modelName = process.env.GAI_LOCAL_MODEL_NAME || '';
const realRun = process.argv.includes('--real');
const resume = process.argv.includes('--resume');
const caseTimeoutMs = Number.parseInt(process.env.GAI_BENCHMARK_CASE_TIMEOUT_MS || '120000', 10);
const concurrency = Number.parseInt(process.env.GAI_BENCHMARK_CONCURRENCY || '1', 10);
const gpuSampleIntervalMs = Number.parseInt(process.env.GAI_GPU_SAMPLE_INTERVAL_MS || '1000', 10);
const fail = (message) => { console.error(`R6_BASELINE_REFUSED: ${message}`); process.exit(2); };

if (benchmarkCases.length !== suiteMeta.expectedCaseCount || benchmarkCases.length < 100) fail(`suite must contain >=100 cases; got ${benchmarkCases.length}`);
if (realRun && !process.env.RUNNER_NAME) fail('real run requires GitHub self-hosted runner context');
if (realRun && !modelEndpoint) fail('real run requires GAI_LOCAL_MODEL_ENDPOINT');
if (realRun && !modelName) fail('real run requires GAI_LOCAL_MODEL_NAME');
if (!Number.isInteger(caseTimeoutMs) || caseTimeoutMs < 1000 || caseTimeoutMs > 600000) fail(`invalid GAI_BENCHMARK_CASE_TIMEOUT_MS=${process.env.GAI_BENCHMARK_CASE_TIMEOUT_MS}`);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) fail(`invalid GAI_BENCHMARK_CONCURRENCY=${process.env.GAI_BENCHMARK_CONCURRENCY}`);
if (!Number.isInteger(gpuSampleIntervalMs) || gpuSampleIntervalMs < 250 || gpuSampleIntervalMs > 10000) fail(`invalid GAI_GPU_SAMPLE_INTERVAL_MS=${process.env.GAI_GPU_SAMPLE_INTERVAL_MS}`);

const suiteSha256 = crypto.createHash('sha256').update(fs.readFileSync(suitePath)).digest('hex');
fs.mkdirSync(outDir, { recursive: true });
const checkpointPath = path.join(outDir, `r6-baseline-${workerId}.json`);
const reportPath = path.join(outDir, `r6-baseline-report-${workerId}.json`);
const progressPath = path.join(outDir, `r6-progress-${workerId}.json`);
const telemetryPath = path.join(outDir, `r6-telemetry-${workerId}.json`);
const previous = resume && fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
if (previous && previous.suiteSha256 !== suiteSha256) fail('resume checkpoint belongs to a different suite hash');
const results = previous?.results || [];
const completedIds = new Set(results.map((item) => item.id));
const runStartedAt = Date.now();
const initialCompletedCount = results.length;

async function probeOllama() {
  const base = modelEndpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`local model endpoint returned HTTP ${response.status}`);
  const body = await response.json();
  const names = (body.models || []).map((item) => item.name || item.model).filter(Boolean);
  if (!names.some((name) => name === modelName || name.startsWith(`${modelName}:`) || modelName.startsWith(`${name}:`))) throw new Error(`configured model '${modelName}' not installed`);
  return { base, names };
}

async function sampleGpu() {
  if (!realRun) return null;
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=utilization.gpu,memory.used,memory.total,power.draw',
      '--format=csv,noheader,nounits',
    ], { timeout: 5000, windowsHide: true });
    const line = String(stdout).trim().split(/\r?\n/)[0];
    if (!line) return null;
    const [utilization, memoryUsedMiB, memoryTotalMiB, powerDrawW] = line.split(',').map((value) => Number.parseFloat(value.trim()));
    return {
      utilizationPct: Number.isFinite(utilization) ? utilization : null,
      memoryUsedMiB: Number.isFinite(memoryUsedMiB) ? memoryUsedMiB : null,
      memoryTotalMiB: Number.isFinite(memoryTotalMiB) ? memoryTotalMiB : null,
      powerDrawW: Number.isFinite(powerDrawW) ? powerDrawW : null,
      sampledAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function summarizeGpu(samples) {
  const valid = samples.filter(Boolean);
  const numeric = (key) => valid.map((sample) => sample[key]).filter(Number.isFinite);
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const max = (values) => values.length ? Math.max(...values) : null;
  const utilization = numeric('utilizationPct');
  const memoryUsed = numeric('memoryUsedMiB');
  const memoryTotal = numeric('memoryTotalMiB');
  const power = numeric('powerDrawW');
  return {
    sampleCount: valid.length,
    avgUtilizationPct: average(utilization),
    maxUtilizationPct: max(utilization),
    avgMemoryUsedMiB: average(memoryUsed),
    maxMemoryUsedMiB: max(memoryUsed),
    memoryTotalMiB: memoryTotal.length ? memoryTotal[0] : null,
    avgPowerDrawW: average(power),
    maxPowerDrawW: max(power),
  };
}

async function withGpuSampling(fn) {
  const samples = [];
  let active = true;
  const collect = async () => {
    if (!active) return;
    const sample = await sampleGpu();
    if (sample) samples.push(sample);
  };
  await collect();
  const timer = realRun ? setInterval(() => { void collect(); }, gpuSampleIntervalMs) : null;
  try {
    const value = await fn();
    return { value, samples };
  } finally {
    active = false;
    if (timer) clearInterval(timer);
    await collect();
  }
}

async function executeCase(testCase) {
  if (!realRun) {
    const verifier = testCase.verifier;
    const output = verifier.type === 'json' ? JSON.stringify(verifier.expected) : verifier.type === 'set' ? verifier.expected.join(',') : String(verifier.expected);
    return { output, adapter: 'fixture-dry-run', model: 'none' };
  }
  const response = await fetch(`${modelEndpoint.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelName, prompt: `${testCase.prompt}\nReturn only the requested answer.`, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(caseTimeoutMs),
  });
  if (!response.ok) throw new Error(`model execution failed HTTP ${response.status}`);
  const body = await response.json();
  return { output: String(body.response ?? '').trim(), adapter: 'ollama-local', model: modelName };
}

async function runCase(testCase, ordinal) {
  console.log(`[R6] START ${ordinal}/${benchmarkCases.length} id=${testCase.id} category=${testCase.category} split=${testCase.split}`);
  const started = Date.now();
  let execution = { output: '', adapter: realRun ? 'ollama-local' : 'fixture-dry-run', model: modelName || 'none' };
  let error = null;
  let samples = [];
  try {
    const sampled = await withGpuSampling(() => executeCase(testCase));
    execution = sampled.value;
    samples = sampled.samples;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const durationMs = Date.now() - started;
  const passed = !error && verifyTypedBenchmark(testCase.verifier, execution.output);
  const gpu = summarizeGpu(samples);
  const timedOut = Boolean(error && /timeout|timed out|aborted/i.test(error));
  return {
    id: testCase.id,
    category: testCase.category,
    split: testCase.split,
    passed,
    durationMs,
    workerId,
    platform: process.platform,
    adapter: execution.adapter,
    model: execution.model,
    output: execution.output,
    error,
    timedOut,
    gpu,
    humanInterventions: 0,
    additionalApiCost: 0,
    createdAt: new Date().toISOString(),
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function buildTelemetry() {
  const durations = results.map((item) => item.durationMs).filter(Number.isFinite);
  const gpuSamples = results.flatMap((item) => {
    const gpu = item.gpu;
    if (!gpu || !gpu.sampleCount) return [];
    return [{
      utilizationPct: gpu.avgUtilizationPct,
      memoryUsedMiB: gpu.maxMemoryUsedMiB,
      memoryTotalMiB: gpu.memoryTotalMiB,
      powerDrawW: gpu.avgPowerDrawW,
    }];
  });
  const slowestCases = [...results]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10)
    .map((item) => ({ id: item.id, category: item.category, split: item.split, durationMs: item.durationMs, passed: item.passed, timedOut: item.timedOut, error: item.error }));
  return {
    schemaVersion: 1,
    suiteId: suiteMeta.suiteId,
    suiteVersion: suiteMeta.version,
    workerId,
    model: realRun ? modelName : 'none',
    settings: { concurrency, caseTimeoutMs, gpuSampleIntervalMs },
    totalCases: results.length,
    completedThisRun: results.length - initialCompletedCount,
    totalWallClockMs: Date.now() - runStartedAt,
    summedCaseDurationMs: durations.reduce((sum, value) => sum + value, 0),
    averageCaseDurationMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    p50CaseDurationMs: percentile(durations, 0.5),
    p95CaseDurationMs: percentile(durations, 0.95),
    maxCaseDurationMs: durations.length ? Math.max(...durations) : null,
    timeoutCount: results.filter((item) => item.timedOut).length,
    slowestCases,
    gpu: summarizeGpu(gpuSamples),
    updatedAt: new Date().toISOString(),
  };
}

function persistState(runtimeProbe) {
  fs.writeFileSync(checkpointPath, JSON.stringify({ schemaVersion: 2, suiteId: suiteMeta.suiteId, suiteVersion: suiteMeta.version, suiteSha256, runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE', runtimeProbe, settings: { concurrency, caseTimeoutMs, gpuSampleIntervalMs }, results }, null, 2));
  fs.writeFileSync(telemetryPath, JSON.stringify(buildTelemetry(), null, 2));
}

let runtimeProbe = { mode: realRun ? 'real' : 'dry-run' };
if (realRun) {
  try { runtimeProbe = { ...runtimeProbe, ...(await probeOllama()) }; }
  catch (error) { fail(error instanceof Error ? error.message : String(error)); }
}

console.log(`[R6] suite=${suiteMeta.suiteId}@${suiteMeta.version} cases=${benchmarkCases.length} model=${realRun ? modelName : 'fixture'} resumeCompleted=${results.length} concurrency=${concurrency} timeoutMs=${caseTimeoutMs}`);

const pendingCases = benchmarkCases.filter((testCase) => !completedIds.has(testCase.id));
for (let offset = 0; offset < pendingCases.length; offset += concurrency) {
  const batch = pendingCases.slice(offset, offset + concurrency);
  const ordinalBase = results.length + 1;
  const batchResults = await Promise.all(batch.map((testCase, index) => runCase(testCase, ordinalBase + index)));
  results.push(...batchResults);
  persistState(runtimeProbe);

  const elapsedMs = Date.now() - runStartedAt;
  const completedThisRun = Math.max(1, results.length - initialCompletedCount);
  const averageWallMsPerCase = elapsedMs / completedThisRun;
  const remaining = benchmarkCases.length - results.length;
  const etaSeconds = Math.round((averageWallMsPerCase * remaining) / 1000);
  const passedSoFar = results.filter((item) => item.passed).length;
  const last = batchResults[batchResults.length - 1];
  const progress = {
    suiteId: suiteMeta.suiteId,
    suiteVersion: suiteMeta.version,
    completed: results.length,
    total: benchmarkCases.length,
    passed: passedSoFar,
    successRateSoFar: results.length ? passedSoFar / results.length : 0,
    currentCase: last.id,
    lastCasePassed: last.passed,
    lastCaseDurationMs: last.durationMs,
    concurrency,
    caseTimeoutMs,
    etaSeconds,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  for (const item of batchResults) {
    console.log(`[R6] DONE ${item.id} passed=${item.passed} durationMs=${item.durationMs} gpuAvg=${item.gpu.avgUtilizationPct ?? 'n/a'} gpuMax=${item.gpu.maxUtilizationPct ?? 'n/a'} vramMaxMiB=${item.gpu.maxMemoryUsedMiB ?? 'n/a'}${item.error ? ` error=${item.error}` : ''}`);
  }
  console.log(`[R6] PROGRESS ${results.length}/${benchmarkCases.length} passRate=${progress.successRateSoFar.toFixed(3)} etaSec=${etaSeconds}`);
}

const passed = results.filter((item) => item.passed).length;
const heldout = results.filter((item) => item.split === 'heldout');
const categories = Object.fromEntries([...new Set(results.map((item) => item.category))].map((category) => {
  const subset = results.filter((item) => item.category === category);
  const categoryPassed = subset.filter((item) => item.passed).length;
  return [category, { total: subset.length, passed: categoryPassed, successRate: categoryPassed / subset.length }];
}));
const telemetry = buildTelemetry();
const report = {
  schemaVersion: 2,
  suiteId: suiteMeta.suiteId,
  suiteVersion: suiteMeta.version,
  suiteSha256,
  runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE',
  worker: { id: workerId, runnerName: process.env.RUNNER_NAME || null, platform: process.platform, arch: os.arch(), hostname: os.hostname() },
  model: realRun ? modelName : 'none',
  settings: { concurrency, caseTimeoutMs, gpuSampleIntervalMs },
  total: results.length,
  passed,
  successRate: results.length ? passed / results.length : 0,
  heldoutTotal: heldout.length,
  heldoutSuccessRate: heldout.length ? heldout.filter((item) => item.passed).length / heldout.length : 0,
  humanInterventionsPerTask: results.length ? results.reduce((sum, item) => sum + item.humanInterventions, 0) / results.length : 0,
  additionalApiCost: 0,
  categories,
  telemetry,
  results,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(telemetryPath, JSON.stringify(telemetry, null, 2));
console.log(JSON.stringify({ reportPath, telemetryPath, runMode: report.runMode, total: report.total, passed: report.passed, successRate: report.successRate, heldoutTotal: report.heldoutTotal, heldoutSuccessRate: report.heldoutSuccessRate, telemetry }, null, 2));
