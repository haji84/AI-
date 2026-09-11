import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('.gai-results');
const checkpointPath = path.join(outDir, 'r4-endurance-checkpoint.json');
const reportPath = path.join(outDir, 'r4-endurance-report.json');
const endpoint = (process.env.GAI_LOCAL_MODEL_ENDPOINT || 'http://127.0.0.1:11434').replace(/\/$/, '');
const model = process.env.GAI_LOCAL_MODEL_NAME || 'qwen3:4b';
const phase = process.argv.find((arg) => arg.startsWith('--phase='))?.slice(8) || 'full';
const totalPlannedSteps = 24;
const phaseEnd = phase === '1' ? 12 : totalPlannedSteps;
const mustResume = phase === '2';
const injectedSteps = new Set([5, 11, 17, 23]);
fs.mkdirSync(outDir, { recursive: true });

let state = { schemaVersion: 1, value: 7, nextStep: 1, checkpoints: [], injectedFailures: 0, retries: 0, strategyPivots: 0, humanInterventions: 0, additionalApiCost: 0, createdAt: new Date().toISOString() };
if (mustResume) {
  if (!fs.existsSync(checkpointPath)) throw new Error('R4 phase 2 requires a phase-1 checkpoint');
  state = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  if (state.nextStep !== 13) throw new Error(`R4 checkpoint expected nextStep=13; got ${state.nextStep}`);
}
if (phase === '1' && fs.existsSync(checkpointPath)) fs.rmSync(checkpointPath);

async function ask(prompt) {
  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = await response.json();
  return String(body.response ?? '').trim();
}

function parseInteger(output) {
  const match = output.match(/-?\d+/);
  return match ? Number(match[0]) : Number.NaN;
}

for (let step = state.nextStep; step <= phaseEnd; step++) {
  const started = Date.now();
  const before = state.value;
  const expected = ((before * 3) + step) % 997;
  let verified = false;
  let output = '';
  let error = null;
  let retriesThisStep = 0;
  let pivotsThisStep = 0;

  for (let attempt = 0; attempt < 4 && !verified; attempt++) {
    try {
      if (attempt === 0 && injectedSteps.has(step)) {
        state.injectedFailures += 1;
        throw new Error('INJECTED_TRANSIENT_TOOL_FAILURE');
      }
      const prompt = attempt < 3
        ? `State=${before}. Compute ((State * 3) + ${step}) mod 997. Return only the integer.`
        : `Carefully verify this arithmetic: (${before} * 3 + ${step}) modulo 997. Return only the final integer, no words.`;
      if (attempt === 3) { state.strategyPivots += 1; pivotsThisStep += 1; }
      output = await ask(prompt);
      verified = parseInteger(output) === expected;
      if (!verified) throw new Error(`verification mismatch: expected ${expected}, got ${output}`);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      if (attempt < 3) { state.retries += 1; retriesThisStep += 1; }
    }
  }

  state.checkpoints.push({
    step,
    completed: verified,
    verified,
    before,
    expected,
    output,
    error: verified ? null : error,
    retries: retriesThisStep,
    strategyPivots: pivotsThisStep,
    humanInterventions: 0,
    elapsedMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  });

  if (!verified) {
    state.nextStep = step;
    fs.writeFileSync(checkpointPath, JSON.stringify(state, null, 2));
    throw new Error(`R4 stopped at unverified step ${step}: ${error}`);
  }

  state.value = expected;
  state.nextStep = step + 1;
  fs.writeFileSync(checkpointPath, JSON.stringify(state, null, 2));
}

if (phase === '1') {
  console.log(JSON.stringify({ phase: 1, verifiedSteps: state.checkpoints.length, nextStep: state.nextStep, checkpointPath }, null, 2));
  process.exit(0);
}

const checkpoints = state.checkpoints;
let prefix = 0;
for (const item of checkpoints) {
  if (item.step !== prefix + 1 || !item.completed || !item.verified) break;
  prefix += 1;
}
const verified = checkpoints.filter((item) => item.completed && item.verified).length;
const report = {
  schemaVersion: 1,
  runMode: 'REAL_SELF_HOSTED_LOCAL_MODEL',
  model,
  endpoint,
  totalSteps: checkpoints.length,
  plannedSteps: totalPlannedSteps,
  completedSteps: verified,
  verifiedCompletionRate: checkpoints.length ? verified / checkpoints.length : 0,
  humanInterventionsPerStep: checkpoints.length ? checkpoints.reduce((sum, item) => sum + item.humanInterventions, 0) / checkpoints.length : 0,
  longestVerifiedPrefix: prefix,
  injectedFailures: state.injectedFailures,
  retries: state.retries,
  strategyPivots: state.strategyPivots,
  resumedFromCheckpoint: mustResume,
  additionalApiCost: state.additionalApiCost,
  checkpoints,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, totalSteps: report.totalSteps, completedSteps: report.completedSteps, verifiedCompletionRate: report.verifiedCompletionRate, injectedFailures: report.injectedFailures, retries: report.retries, strategyPivots: report.strategyPivots }, null, 2));
