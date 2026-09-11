import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const manifestPath = path.join(root, 'benchmarks/internal/v1/manifest.json');
const outDir = path.join(root, '.gai-results');
const workerId = process.env.GAI_WORKER_ID || process.env.RUNNER_NAME || os.hostname();
const platform = process.platform;
const modelEndpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT || '';
const modelName = process.env.GAI_LOCAL_MODEL_NAME || '';
const realRun = process.argv.includes('--real');
const resume = process.argv.includes('--resume');

function fail(message) {
  console.error(`BASELINE_REFUSED: ${message}`);
  process.exit(2);
}

if (!fs.existsSync(manifestPath)) fail('Benchmark manifest is missing');
if (realRun && !process.env.RUNNER_NAME) fail('Real run requires GitHub self-hosted runner context (RUNNER_NAME)');
if (realRun && !modelEndpoint) fail('Real run requires GAI_LOCAL_MODEL_ENDPOINT');
if (realRun && !modelName) fail('Real run requires GAI_LOCAL_MODEL_NAME');

const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
fs.mkdirSync(outDir, { recursive: true });
const checkpointPath = path.join(outDir, `baseline-${workerId}.json`);
let previous = null;
if (resume && fs.existsSync(checkpointPath)) previous = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
const completedIds = new Set(previous?.results?.map((r) => r.id) || []);
const results = previous?.results || [];

async function probeOllama() {
  const base = modelEndpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`local model endpoint returned HTTP ${response.status}`);
  const body = await response.json();
  const names = (body.models || []).map((m) => m.name || m.model).filter(Boolean);
  if (!names.some((n) => n === modelName || n.startsWith(`${modelName}:`) || modelName.startsWith(`${n}:`))) {
    throw new Error(`configured model '${modelName}' not present; installed=${names.join(',') || 'none'}`);
  }
  return { base, names };
}

async function executeCase(c) {
  if (!realRun) {
    return { output: String(c.expected ?? c.expectedContains ?? ''), adapter: 'fixture-dry-run', model: 'none' };
  }
  const base = modelEndpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelName, prompt: `${c.prompt}\nReturn only the answer.`, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`model execution failed HTTP ${response.status}`);
  const body = await response.json();
  return { output: String(body.response ?? '').trim(), adapter: 'ollama-local', model: modelName };
}

function verify(c, output) {
  const normalized = String(output).trim().replace(/\s+/g, ' ');
  if ('expected' in c) return normalized.toLowerCase() === String(c.expected).trim().replace(/\s+/g, ' ').toLowerCase();
  if ('expectedContains' in c) return normalized.toLowerCase().includes(String(c.expectedContains).toLowerCase());
  return false;
}

let runtimeProbe = { mode: realRun ? 'real' : 'dry-run' };
if (realRun) {
  try { runtimeProbe = { ...runtimeProbe, ...(await probeOllama()) }; }
  catch (error) { fail(error.message); }
}

for (const c of manifest.cases) {
  if (completedIds.has(c.id)) continue;
  const started = Date.now();
  let execution;
  let error = null;
  try { execution = await executeCase(c); }
  catch (e) { error = e instanceof Error ? e.message : String(e); execution = { output: '', adapter: realRun ? 'ollama-local' : 'fixture-dry-run', model: modelName || 'none' }; }
  const passed = !error && verify(c, execution.output);
  results.push({
    id: c.id,
    category: c.category,
    split: c.split,
    passed,
    durationMs: Date.now() - started,
    workerId,
    platform,
    adapter: execution.adapter,
    model: execution.model,
    output: execution.output,
    error,
    humanInterventions: 0,
    additionalApiCost: 0,
    createdAt: new Date().toISOString(),
  });
  const snapshot = {
    schemaVersion: 1,
    suiteId: manifest.suiteId,
    suiteVersion: manifest.version,
    manifestSha256,
    runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE',
    worker: { id: workerId, runnerName: process.env.RUNNER_NAME || null, platform, arch: os.arch(), hostname: os.hostname() },
    runtimeProbe,
    results,
  };
  fs.writeFileSync(checkpointPath, JSON.stringify(snapshot, null, 2));
}

const passed = results.filter((r) => r.passed).length;
const heldout = results.filter((r) => r.split === 'heldout');
const report = {
  schemaVersion: 1,
  suiteId: manifest.suiteId,
  suiteVersion: manifest.version,
  manifestSha256,
  runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE',
  worker: { id: workerId, runnerName: process.env.RUNNER_NAME || null, platform, arch: os.arch(), hostname: os.hostname() },
  model: realRun ? modelName : 'none',
  total: results.length,
  passed,
  successRate: results.length ? passed / results.length : 0,
  heldoutTotal: heldout.length,
  heldoutSuccessRate: heldout.length ? heldout.filter((r) => r.passed).length / heldout.length : 0,
  humanInterventionsPerTask: results.length ? results.reduce((n, r) => n + r.humanInterventions, 0) / results.length : 0,
  additionalApiCost: results.reduce((n, r) => n + r.additionalApiCost, 0),
  results,
  completedAt: new Date().toISOString(),
};
const reportPath = path.join(outDir, `baseline-report-${workerId}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, runMode: report.runMode, total: report.total, passed: report.passed, successRate: report.successRate }, null, 2));
