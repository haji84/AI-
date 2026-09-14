import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { benchmarkCases, suiteMeta } from '../benchmarks/internal/v1_1/suite.mjs';
import { verifyTypedBenchmark } from '../src/gai/typed-benchmark-verifier.ts';

const execFileAsync = promisify(execFile);
const outDir = path.join(process.cwd(), '.gai-results');
const endpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT || 'http://127.0.0.1:11434';
const model = process.env.GAI_LOCAL_MODEL_NAME || 'qwen3:4b';
const caseTimeoutMs = Number.parseInt(process.env.GAI_CALIBRATION_CASE_TIMEOUT_MS || '120000', 10);
const sampleSize = Number.parseInt(process.env.GAI_CALIBRATION_SAMPLE_SIZE || '12', 10);
const gpuSampleIntervalMs = Number.parseInt(process.env.GAI_GPU_SAMPLE_INTERVAL_MS || '1000', 10);
const fail = (message) => { console.error(`R6_CALIBRATION_REFUSED: ${message}`); process.exit(2); };

if (!process.env.RUNNER_NAME) fail('calibration requires GitHub self-hosted runner context');
if (!Number.isInteger(sampleSize) || sampleSize < 4 || sampleSize > 30) fail(`invalid sample size ${sampleSize}`);
if (!Number.isInteger(caseTimeoutMs) || caseTimeoutMs < 1000 || caseTimeoutMs > 600000) fail(`invalid case timeout ${caseTimeoutMs}`);
if (!Number.isInteger(gpuSampleIntervalMs) || gpuSampleIntervalMs < 250 || gpuSampleIntervalMs > 10000) fail(`invalid GPU sample interval ${gpuSampleIntervalMs}`);
fs.mkdirSync(outDir, { recursive: true });

function chooseBalancedCases(cases, limit) {
  const groups = new Map();
  for (const testCase of cases) {
    const key = `${testCase.category}:${testCase.split}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(testCase);
  }
  const queues = [...groups.values()];
  const selected = [];
  while (selected.length < limit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (selected.length >= limit) break;
      const next = queue.shift();
      if (next) selected.push(next);
    }
  }
  return selected;
}

async function probeOllama() {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) fail(`Ollama returned HTTP ${response.status}`);
  const body = await response.json();
  const names = (body.models || []).map((item) => item.name || item.model).filter(Boolean);
  if (!names.some((name) => name === model || name.startsWith(`${model}:`) || model.startsWith(`${name}:`))) fail(`configured model '${model}' not installed`);
}

async function sampleGpu() {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=utilization.gpu,memory.used,memory.total,power.draw',
      '--format=csv,noheader,nounits',
    ], { timeout: 5000, windowsHide: true });
    const line = String(stdout).trim().split(/\r?\n/)[0];
    if (!line) return null;
    const [utilizationPct, memoryUsedMiB, memoryTotalMiB, powerDrawW] = line.split(',').map((value) => Number.parseFloat(value.trim()));
    return { utilizationPct, memoryUsedMiB, memoryTotalMiB, powerDrawW, sampledAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

function summarizeGpu(samples) {
  const valid = samples.filter(Boolean);
  const values = (key) => valid.map((sample) => sample[key]).filter(Number.isFinite);
  const avg = (list) => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
  const max = (list) => list.length ? Math.max(...list) : null;
  const utilization = values('utilizationPct');
  const memoryUsed = values('memoryUsedMiB');
  const memoryTotal = values('memoryTotalMiB');
  const power = values('powerDrawW');
  return {
    sampleCount: valid.length,
    avgUtilizationPct: avg(utilization),
    maxUtilizationPct: max(utilization),
    avgMemoryUsedMiB: avg(memoryUsed),
    maxMemoryUsedMiB: max(memoryUsed),
    memoryTotalMiB: memoryTotal.length ? memoryTotal[0] : null,
    avgPowerDrawW: avg(power),
    maxPowerDrawW: max(power),
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

async function executeCase(testCase) {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: `${testCase.prompt}\nReturn only the requested answer.`, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(caseTimeoutMs),
  });
  if (!response.ok) throw new Error(`model execution failed HTTP ${response.status}`);
  const body = await response.json();
  return String(body.response ?? '').trim();
}

async function runOne(testCase, profileName) {
  const samples = [];
  let sampling = true;
  let samplingBusy = false;
  const collect = async () => {
    if (!sampling || samplingBusy) return;
    samplingBusy = true;
    try {
      const sample = await sampleGpu();
      if (sample) samples.push(sample);
    } finally {
      samplingBusy = false;
    }
  };
  await collect();
  const timer = setInterval(() => { void collect(); }, gpuSampleIntervalMs);
  const started = Date.now();
  let output = '';
  let error = null;
  try {
    output = await executeCase(testCase);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    sampling = false;
    clearInterval(timer);
  }
  const durationMs = Date.now() - started;
  const passed = !error && verifyTypedBenchmark(testCase.verifier, output);
  return {
    id: testCase.id,
    category: testCase.category,
    split: testCase.split,
    profileName,
    durationMs,
    passed,
    timedOut: Boolean(error && /timeout|timed out|aborted/i.test(error)),
    error,
    gpu: summarizeGpu(samples),
  };
}

async function runProfile(testCases, concurrency) {
  const profileName = `c${concurrency}`;
  const started = Date.now();
  const results = [];
  for (let offset = 0; offset < testCases.length; offset += concurrency) {
    const batch = testCases.slice(offset, offset + concurrency);
    console.log(`[CAL] ${profileName} batch ${offset + 1}-${offset + batch.length}/${testCases.length}`);
    const batchResults = await Promise.all(batch.map((testCase) => runOne(testCase, profileName)));
    results.push(...batchResults);
    for (const result of batchResults) {
      console.log(`[CAL] ${profileName} id=${result.id} passed=${result.passed} durationMs=${result.durationMs} gpuAvg=${result.gpu.avgUtilizationPct ?? 'n/a'} vramMaxMiB=${result.gpu.maxMemoryUsedMiB ?? 'n/a'}${result.error ? ` error=${result.error}` : ''}`);
    }
  }
  const wallClockMs = Date.now() - started;
  const durations = results.map((result) => result.durationMs);
  const passed = results.filter((result) => result.passed).length;
  const gpuSummaries = results.map((result) => result.gpu).filter((gpu) => gpu.sampleCount > 0);
  const maxMemoryUsedMiB = gpuSummaries.length ? Math.max(...gpuSummaries.map((gpu) => gpu.maxMemoryUsedMiB).filter(Number.isFinite)) : null;
  const memoryTotalMiB = gpuSummaries.find((gpu) => Number.isFinite(gpu.memoryTotalMiB))?.memoryTotalMiB ?? null;
  const maxUtilizationPct = gpuSummaries.length ? Math.max(...gpuSummaries.map((gpu) => gpu.maxUtilizationPct).filter(Number.isFinite)) : null;
  return {
    profileName,
    concurrency,
    caseTimeoutMs,
    total: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    timeoutCount: results.filter((result) => result.timedOut).length,
    wallClockMs,
    summedCaseDurationMs: durations.reduce((sum, value) => sum + value, 0),
    averageCaseDurationMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    p50CaseDurationMs: percentile(durations, 0.5),
    p95CaseDurationMs: percentile(durations, 0.95),
    maxCaseDurationMs: durations.length ? Math.max(...durations) : null,
    gpu: { maxMemoryUsedMiB, memoryTotalMiB, maxUtilizationPct },
    results,
  };
}

function recommend(sequential, parallel) {
  const speedup = parallel.wallClockMs > 0 ? sequential.wallClockMs / parallel.wallClockMs : 0;
  const vramRatio = Number.isFinite(parallel.gpu.maxMemoryUsedMiB) && Number.isFinite(parallel.gpu.memoryTotalMiB) && parallel.gpu.memoryTotalMiB > 0
    ? parallel.gpu.maxMemoryUsedMiB / parallel.gpu.memoryTotalMiB
    : null;
  const accuracySafe = parallel.passRate >= sequential.passRate;
  const timeoutSafe = parallel.timeoutCount <= sequential.timeoutCount;
  const memorySafe = vramRatio === null ? false : vramRatio <= 0.9;
  const promoteParallel = speedup >= 1.15 && accuracySafe && timeoutSafe && memorySafe;
  const measuredP95 = Math.max(sequential.p95CaseDurationMs || 0, parallel.p95CaseDurationMs || 0);
  const timeoutCandidate = Math.min(120000, Math.max(30000, Math.ceil((measuredP95 * 1.5) / 1000) * 1000));
  const recommendedCaseTimeoutMs = sequential.timeoutCount || parallel.timeoutCount ? 120000 : timeoutCandidate;
  return {
    recommendedConcurrency: promoteParallel ? 2 : 1,
    recommendedCaseTimeoutMs,
    speedupConcurrency2Vs1: speedup,
    vramRatioConcurrency2: vramRatio,
    checks: { accuracySafe, timeoutSafe, memorySafe, minimumSpeedupMet: speedup >= 1.15 },
    reason: promoteParallel ? 'concurrency_2_meets_speed_accuracy_timeout_and_vram_gates' : 'retain_concurrency_1_until_all_parallel_safety_gates_pass',
  };
}

await probeOllama();
const selectedCases = chooseBalancedCases(benchmarkCases, sampleSize);
console.log(`[CAL] suite=${suiteMeta.suiteId}@${suiteMeta.version} model=${model} sampleSize=${selectedCases.length} ids=${selectedCases.map((item) => item.id).join(',')}`);
const sequential = await runProfile(selectedCases, 1);
const parallel = await runProfile(selectedCases, 2);
const recommendation = recommend(sequential, parallel);
const report = {
  schemaVersion: 1,
  suiteId: suiteMeta.suiteId,
  suiteVersion: suiteMeta.version,
  worker: { runnerName: process.env.RUNNER_NAME, hostname: os.hostname(), platform: process.platform, arch: os.arch() },
  model,
  sampleSize: selectedCases.length,
  selectedCaseIds: selectedCases.map((item) => item.id),
  sequential,
  parallel,
  recommendation,
  additionalApiCost: 0,
  completedAt: new Date().toISOString(),
};
const reportPath = path.join(outDir, 'r6-zbook-calibration.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, recommendation, sequential: { passRate: sequential.passRate, wallClockMs: sequential.wallClockMs }, parallel: { passRate: parallel.passRate, wallClockMs: parallel.wallClockMs } }, null, 2));
