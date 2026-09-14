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
const caseTimeoutMs = Number.parseInt(process.env.GAI_BENCHMARK_CASE_TIMEOUT_MS || '120000', 10);
const maxOutputTokens = Number.parseInt(process.env.GAI_BENCHMARK_NUM_PREDICT || '96', 10);
const fail = (message) => { console.error(`R6_OPTIMIZED_REFUSED: ${message}`); process.exit(2); };

if (benchmarkCases.length !== suiteMeta.expectedCaseCount || benchmarkCases.length < 100) fail(`suite must contain >=100 cases; got ${benchmarkCases.length}`);
if (realRun && !process.env.RUNNER_NAME) fail('real run requires GitHub self-hosted runner context');
if (realRun && (!modelEndpoint || !modelName)) fail('real run requires local model endpoint and model name');
if (!Number.isInteger(caseTimeoutMs) || caseTimeoutMs < 1000 || caseTimeoutMs > 600000) fail('invalid case timeout');
if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 8 || maxOutputTokens > 512) fail('invalid output token limit');

const suiteSha256 = crypto.createHash('sha256').update(fs.readFileSync(suitePath)).digest('hex');
fs.mkdirSync(outDir, { recursive: true });
const reportPath = path.join(outDir, `r6-baseline-report-${workerId}.json`);
const telemetryPath = path.join(outDir, `r6-telemetry-${workerId}.json`);
const progressPath = path.join(outDir, `r6-progress-${workerId}.json`);
const startedAt = Date.now();
const results = [];

async function probeOllama() {
  const response = await fetch(`${modelEndpoint.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`local model endpoint returned HTTP ${response.status}`);
  const body = await response.json();
  const names = (body.models || []).map((item) => item.name || item.model).filter(Boolean);
  if (!names.some((name) => name === modelName || name.startsWith(`${modelName}:`) || modelName.startsWith(`${name}:`))) throw new Error(`configured model '${modelName}' not installed`);
}

async function sampleGpu() {
  if (!realRun) return null;
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total,power.draw','--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true });
    const [utilizationPct, memoryUsedMiB, memoryTotalMiB, powerDrawW] = String(stdout).trim().split(/\r?\n/)[0].split(',').map((v) => Number.parseFloat(v.trim()));
    return { utilizationPct, memoryUsedMiB, memoryTotalMiB, powerDrawW };
  } catch { return null; }
}

function answerContract(testCase) {
  if (testCase.verifier.type === 'json') return 'Return valid JSON only. Preserve primitive types from the source: numbers as JSON numbers and yes/no or true/false as JSON booleans. No markdown or explanation.';
  if (testCase.category === 'coding') return 'Return only the requested JavaScript or TypeScript code/type expression. No markdown fences and no explanation.';
  return 'Return only the final requested answer. No reasoning, explanation, markdown, labels, or extra text.';
}

function cleanOutput(output) {
  return String(output ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json|javascript|js|typescript|ts)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function executeCase(testCase) {
  if (!realRun) {
    const verifier = testCase.verifier;
    const output = verifier.type === 'json' ? JSON.stringify(verifier.expected) : verifier.type === 'set' ? verifier.expected.join(',') : String(verifier.expected);
    return { output, adapter: 'fixture-dry-run', model: 'none' };
  }
  const body = {
    model: modelName,
    prompt: `/no_think\n${testCase.prompt}\n${answerContract(testCase)}`,
    stream: false,
    options: { temperature: 0, num_predict: maxOutputTokens },
  };
  if (testCase.verifier.type === 'json') body.format = 'json';
  const response = await fetch(`${modelEndpoint.replace(/\/$/, '')}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(caseTimeoutMs),
  });
  if (!response.ok) throw new Error(`model execution failed HTTP ${response.status}`);
  const payload = await response.json();
  return { output: cleanOutput(payload.response), adapter: 'ollama-local-optimized', model: modelName };
}

async function runCase(testCase, ordinal) {
  const started = Date.now();
  let execution = { output: '', adapter: realRun ? 'ollama-local-optimized' : 'fixture-dry-run', model: modelName || 'none' };
  let error = null;
  try { execution = await executeCase(testCase); } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  const durationMs = Date.now() - started;
  const output = cleanOutput(execution.output);
  const passed = !error && verifyTypedBenchmark(testCase.verifier, output);
  const timedOut = Boolean(error && /timeout|timed out|aborted/i.test(error));
  const gpu = await sampleGpu();
  const item = {
    id: testCase.id, category: testCase.category, split: testCase.split, passed, durationMs,
    workerId, platform: process.platform, adapter: execution.adapter, model: execution.model,
    output, error, timedOut,
    gpu: gpu ? { sampleCount: 1, avgUtilizationPct: gpu.utilizationPct, maxUtilizationPct: gpu.utilizationPct, avgMemoryUsedMiB: gpu.memoryUsedMiB, maxMemoryUsedMiB: gpu.memoryUsedMiB, memoryTotalMiB: gpu.memoryTotalMiB, avgPowerDrawW: gpu.powerDrawW, maxPowerDrawW: gpu.powerDrawW } : { sampleCount: 0 },
    humanInterventions: 0, additionalApiCost: 0, createdAt: new Date().toISOString(),
  };
  console.log(`[R6-OPT] ${ordinal}/${benchmarkCases.length} ${item.id} passed=${passed} durationMs=${durationMs}${error ? ` error=${error}` : ''}`);
  return item;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length-1, Math.max(0, Math.ceil(sorted.length*fraction)-1))];
}

function buildTelemetry() {
  const durations = results.map((r) => r.durationMs);
  const gpuItems = results.map((r) => r.gpu).filter((g) => g?.sampleCount);
  const avg = (values) => values.length ? values.reduce((a,b) => a+b,0)/values.length : null;
  const vals = (key) => gpuItems.map((g) => g[key]).filter(Number.isFinite);
  return {
    schemaVersion: 2, suiteId: suiteMeta.suiteId, suiteVersion: suiteMeta.version, workerId,
    model: realRun ? modelName : 'none', settings: { concurrency: 1, caseTimeoutMs, maxOutputTokens, noThink: true },
    totalCases: results.length, totalWallClockMs: Date.now()-startedAt,
    summedCaseDurationMs: durations.reduce((a,b) => a+b,0), averageCaseDurationMs: avg(durations),
    p50CaseDurationMs: percentile(durations,0.5), p95CaseDurationMs: percentile(durations,0.95), maxCaseDurationMs: durations.length ? Math.max(...durations) : null,
    timeoutCount: results.filter((r) => r.timedOut).length,
    slowestCases: [...results].sort((a,b) => b.durationMs-a.durationMs).slice(0,10).map((r) => ({ id:r.id, category:r.category, split:r.split, durationMs:r.durationMs, passed:r.passed, timedOut:r.timedOut, error:r.error })),
    gpu: {
      sampleCount: gpuItems.length,
      avgUtilizationPct: avg(vals('avgUtilizationPct')), maxUtilizationPct: vals('maxUtilizationPct').length ? Math.max(...vals('maxUtilizationPct')) : null,
      avgMemoryUsedMiB: avg(vals('avgMemoryUsedMiB')), maxMemoryUsedMiB: vals('maxMemoryUsedMiB').length ? Math.max(...vals('maxMemoryUsedMiB')) : null,
      memoryTotalMiB: vals('memoryTotalMiB')[0] ?? null,
      avgPowerDrawW: avg(vals('avgPowerDrawW')), maxPowerDrawW: vals('maxPowerDrawW').length ? Math.max(...vals('maxPowerDrawW')) : null,
    },
    updatedAt: new Date().toISOString(),
  };
}

if (realRun) await probeOllama();
for (let i=0; i<benchmarkCases.length; i++) {
  results.push(await runCase(benchmarkCases[i], i+1));
  const passed = results.filter((r) => r.passed).length;
  fs.writeFileSync(progressPath, JSON.stringify({ completed: results.length, total: benchmarkCases.length, passed, successRateSoFar: passed/results.length, currentCase: benchmarkCases[i].id, updatedAt: new Date().toISOString() }, null, 2));
}

const passed = results.filter((r) => r.passed).length;
const heldout = results.filter((r) => r.split === 'heldout');
const categories = Object.fromEntries([...new Set(results.map((r) => r.category))].map((category) => {
  const subset = results.filter((r) => r.category === category);
  const categoryPassed = subset.filter((r) => r.passed).length;
  return [category, { total: subset.length, passed: categoryPassed, successRate: categoryPassed/subset.length }];
}));
const telemetry = buildTelemetry();
const report = {
  schemaVersion: 3, suiteId: suiteMeta.suiteId, suiteVersion: suiteMeta.version, suiteSha256,
  runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE',
  worker: { id: workerId, runnerName: process.env.RUNNER_NAME || null, platform: process.platform, arch: os.arch(), hostname: os.hostname() },
  model: realRun ? modelName : 'none', settings: telemetry.settings,
  total: results.length, passed, successRate: passed/results.length,
  heldoutTotal: heldout.length, heldoutSuccessRate: heldout.length ? heldout.filter((r) => r.passed).length/heldout.length : 0,
  humanInterventionsPerTask: 0, additionalApiCost: 0, categories, telemetry, results, completedAt: new Date().toISOString(),
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(telemetryPath, JSON.stringify(telemetry, null, 2));
console.log(JSON.stringify({ reportPath, total: report.total, passed: report.passed, successRate: report.successRate, heldoutSuccessRate: report.heldoutSuccessRate, telemetry }, null, 2));
