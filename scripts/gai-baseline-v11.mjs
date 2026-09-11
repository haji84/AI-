import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { benchmarkCases, suiteMeta } from '../benchmarks/internal/v1_1/suite.mjs';
import { verifyTypedBenchmark } from '../src/gai/typed-benchmark-verifier.ts';

const root = process.cwd();
const suitePath = path.join(root, 'benchmarks/internal/v1_1/suite.mjs');
const outDir = path.join(root, '.gai-results');
const workerId = process.env.GAI_WORKER_ID || process.env.RUNNER_NAME || os.hostname();
const modelEndpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT || '';
const modelName = process.env.GAI_LOCAL_MODEL_NAME || '';
const realRun = process.argv.includes('--real');
const resume = process.argv.includes('--resume');
const fail = (message) => { console.error(`R6_BASELINE_REFUSED: ${message}`); process.exit(2); };

if (benchmarkCases.length !== suiteMeta.expectedCaseCount || benchmarkCases.length < 100) fail(`suite must contain >=100 cases; got ${benchmarkCases.length}`);
if (realRun && !process.env.RUNNER_NAME) fail('real run requires GitHub self-hosted runner context');
if (realRun && !modelEndpoint) fail('real run requires GAI_LOCAL_MODEL_ENDPOINT');
if (realRun && !modelName) fail('real run requires GAI_LOCAL_MODEL_NAME');

const suiteSha256 = crypto.createHash('sha256').update(fs.readFileSync(suitePath)).digest('hex');
fs.mkdirSync(outDir, { recursive: true });
const checkpointPath = path.join(outDir, `r6-baseline-${workerId}.json`);
const reportPath = path.join(outDir, `r6-baseline-report-${workerId}.json`);
const progressPath = path.join(outDir, `r6-progress-${workerId}.json`);
const previous = resume && fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
if (previous && previous.suiteSha256 !== suiteSha256) fail('resume checkpoint belongs to a different suite hash');
const results = previous?.results || [];
const completedIds = new Set(results.map((item) => item.id));
const runStartedAt = Date.now();

async function probeOllama() {
  const base = modelEndpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`local model endpoint returned HTTP ${response.status}`);
  const body = await response.json();
  const names = (body.models || []).map((item) => item.name || item.model).filter(Boolean);
  if (!names.some((name) => name === modelName || name.startsWith(`${modelName}:`) || modelName.startsWith(`${name}:`))) throw new Error(`configured model '${modelName}' not installed`);
  return { base, names };
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
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`model execution failed HTTP ${response.status}`);
  const body = await response.json();
  return { output: String(body.response ?? '').trim(), adapter: 'ollama-local', model: modelName };
}

let runtimeProbe = { mode: realRun ? 'real' : 'dry-run' };
if (realRun) {
  try { runtimeProbe = { ...runtimeProbe, ...(await probeOllama()) }; }
  catch (error) { fail(error instanceof Error ? error.message : String(error)); }
}

console.log(`[R6] suite=${suiteMeta.suiteId}@${suiteMeta.version} cases=${benchmarkCases.length} model=${realRun ? modelName : 'fixture'} resumeCompleted=${results.length}`);

for (const testCase of benchmarkCases) {
  if (completedIds.has(testCase.id)) continue;
  const ordinal = results.length + 1;
  console.log(`[R6] START ${ordinal}/${benchmarkCases.length} id=${testCase.id} category=${testCase.category} split=${testCase.split}`);
  const started = Date.now();
  let execution = { output: '', adapter: realRun ? 'ollama-local' : 'fixture-dry-run', model: modelName || 'none' };
  let error = null;
  try { execution = await executeCase(testCase); } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  const durationMs = Date.now() - started;
  const passed = !error && verifyTypedBenchmark(testCase.verifier, execution.output);
  results.push({
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
    humanInterventions: 0,
    additionalApiCost: 0,
    createdAt: new Date().toISOString(),
  });
  fs.writeFileSync(checkpointPath, JSON.stringify({ schemaVersion: 1, suiteId: suiteMeta.suiteId, suiteVersion: suiteMeta.version, suiteSha256, runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE', runtimeProbe, results }, null, 2));

  const elapsedMs = Date.now() - runStartedAt;
  const completedThisRun = Math.max(1, results.length - (previous?.results?.length || 0));
  const averageMs = elapsedMs / completedThisRun;
  const remaining = benchmarkCases.length - results.length;
  const etaSeconds = Math.round((averageMs * remaining) / 1000);
  const passedSoFar = results.filter((item) => item.passed).length;
  const progress = {
    suiteId: suiteMeta.suiteId,
    suiteVersion: suiteMeta.version,
    completed: results.length,
    total: benchmarkCases.length,
    passed: passedSoFar,
    successRateSoFar: results.length ? passedSoFar / results.length : 0,
    currentCase: testCase.id,
    lastCasePassed: passed,
    lastCaseDurationMs: durationMs,
    etaSeconds,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  console.log(`[R6] DONE ${results.length}/${benchmarkCases.length} id=${testCase.id} passed=${passed} durationMs=${durationMs} passRate=${progress.successRateSoFar.toFixed(3)} etaSec=${etaSeconds}${error ? ` error=${error}` : ''}`);
}

const passed = results.filter((item) => item.passed).length;
const heldout = results.filter((item) => item.split === 'heldout');
const categories = Object.fromEntries([...new Set(results.map((item) => item.category))].map((category) => {
  const subset = results.filter((item) => item.category === category);
  const categoryPassed = subset.filter((item) => item.passed).length;
  return [category, { total: subset.length, passed: categoryPassed, successRate: categoryPassed / subset.length }];
}));
const report = {
  schemaVersion: 1,
  suiteId: suiteMeta.suiteId,
  suiteVersion: suiteMeta.version,
  suiteSha256,
  runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE',
  worker: { id: workerId, runnerName: process.env.RUNNER_NAME || null, platform: process.platform, arch: os.arch(), hostname: os.hostname() },
  model: realRun ? modelName : 'none',
  total: results.length,
  passed,
  successRate: results.length ? passed / results.length : 0,
  heldoutTotal: heldout.length,
  heldoutSuccessRate: heldout.length ? heldout.filter((item) => item.passed).length / heldout.length : 0,
  humanInterventionsPerTask: results.length ? results.reduce((sum, item) => sum + item.humanInterventions, 0) / results.length : 0,
  additionalApiCost: 0,
  categories,
  results,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, runMode: report.runMode, total: report.total, passed: report.passed, successRate: report.successRate, heldoutTotal: report.heldoutTotal, heldoutSuccessRate: report.heldoutSuccessRate }, null, 2));
