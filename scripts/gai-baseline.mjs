import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { benchmarkCases, suiteMeta } from '../benchmarks/internal/v1/suite.mjs';

const root = process.cwd();
const suitePath = path.join(root, 'benchmarks/internal/v1/suite.mjs');
const outDir = path.join(root, '.gai-results');
const workerId = process.env.GAI_WORKER_ID || process.env.RUNNER_NAME || os.hostname();
const platform = process.platform;
const modelEndpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT || '';
const modelName = process.env.GAI_LOCAL_MODEL_NAME || '';
const realRun = process.argv.includes('--real');
const resume = process.argv.includes('--resume');
const fail = (message) => { console.error(`BASELINE_REFUSED: ${message}`); process.exit(2); };

if (benchmarkCases.length !== suiteMeta.expectedCaseCount || benchmarkCases.length < 100) fail(`frozen suite must contain >=100 cases; got ${benchmarkCases.length}`);
if (realRun && !process.env.RUNNER_NAME) fail('real run requires GitHub self-hosted runner context');
if (realRun && !modelEndpoint) fail('real run requires GAI_LOCAL_MODEL_ENDPOINT');
if (realRun && !modelName) fail('real run requires GAI_LOCAL_MODEL_NAME');

const suiteBytes = fs.readFileSync(suitePath);
const suiteSha256 = crypto.createHash('sha256').update(suiteBytes).digest('hex');
fs.mkdirSync(outDir, { recursive: true });
const checkpointPath = path.join(outDir, `baseline-${workerId}.json`);
const previous = resume && fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
if (previous && previous.suiteSha256 !== suiteSha256) fail('resume checkpoint belongs to a different frozen suite');
const results = previous?.results || [];
const completedIds = new Set(results.map((r) => r.id));

async function probeOllama() {
  const base = modelEndpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`local model endpoint returned HTTP ${response.status}`);
  const body = await response.json();
  const names = (body.models || []).map((m) => m.name || m.model).filter(Boolean);
  if (!names.some((n) => n === modelName || n.startsWith(`${modelName}:`) || modelName.startsWith(`${n}:`))) throw new Error(`configured model '${modelName}' not installed; installed=${names.join(',') || 'none'}`);
  return { base, names };
}

async function executeCase(c) {
  if (!realRun) return { output: String(c.expected ?? c.expectedContains ?? ''), adapter: 'fixture-dry-run', model: 'none' };
  const response = await fetch(`${modelEndpoint.replace(/\/$/, '')}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
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
if (realRun) { try { runtimeProbe = { ...runtimeProbe, ...(await probeOllama()) }; } catch (error) { fail(error.message); } }

for (const c of benchmarkCases) {
  if (completedIds.has(c.id)) continue;
  const started = Date.now();
  let execution = { output: '', adapter: realRun ? 'ollama-local' : 'fixture-dry-run', model: modelName || 'none' };
  let error = null;
  try { execution = await executeCase(c); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  results.push({ id: c.id, category: c.category, split: c.split, passed: !error && verify(c, execution.output), durationMs: Date.now() - started, workerId, platform, adapter: execution.adapter, model: execution.model, output: execution.output, error, humanInterventions: 0, additionalApiCost: 0, createdAt: new Date().toISOString() });
  fs.writeFileSync(checkpointPath, JSON.stringify({ schemaVersion: 1, suiteId: suiteMeta.suiteId, suiteVersion: suiteMeta.version, suiteSha256, runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE', worker: { id: workerId, runnerName: process.env.RUNNER_NAME || null, platform, arch: os.arch(), hostname: os.hostname() }, runtimeProbe, results }, null, 2));
}

const passed = results.filter((r) => r.passed).length;
const heldout = results.filter((r) => r.split === 'heldout');
const report = { schemaVersion: 1, suiteId: suiteMeta.suiteId, suiteVersion: suiteMeta.version, suiteSha256, runMode: realRun ? 'REAL_SELF_HOSTED_LOCAL_MODEL' : 'DRY_RUN_FIXTURE', worker: { id: workerId, runnerName: process.env.RUNNER_NAME || null, platform, arch: os.arch(), hostname: os.hostname() }, model: realRun ? modelName : 'none', total: results.length, passed, successRate: results.length ? passed / results.length : 0, heldoutTotal: heldout.length, heldoutSuccessRate: heldout.length ? heldout.filter((r) => r.passed).length / heldout.length : 0, humanInterventionsPerTask: results.length ? results.reduce((n, r) => n + r.humanInterventions, 0) / results.length : 0, additionalApiCost: 0, results, completedAt: new Date().toISOString() };
const reportPath = path.join(outDir, `baseline-report-${workerId}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, runMode: report.runMode, total: report.total, passed: report.passed, successRate: report.successRate, heldoutTotal: report.heldoutTotal }, null, 2));
