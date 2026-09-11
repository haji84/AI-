import fs from 'node:fs';
import path from 'node:path';
import { benchmarkCases } from '../benchmarks/internal/v1/suite.mjs';
import { buildR2ImprovementEvidence } from '../src/gai/research-stage-evidence.ts';

const outDir = path.resolve('.gai-results');
const refDir = path.resolve('.gai-reference/r1');
const endpoint = (process.env.GAI_LOCAL_MODEL_ENDPOINT || 'http://127.0.0.1:11434').replace(/\/$/, '');
const model = process.env.GAI_LOCAL_MODEL_NAME || 'qwen3:4b';
if (process.env.R2_SAFETY_VERIFIED !== '1') throw new Error('R2 requires the targeted safety regression set to pass before candidate evaluation');
fs.mkdirSync(outDir, { recursive: true });

const reportFiles = fs.readdirSync(refDir).filter((name) => name.startsWith('baseline-report-') && name.endsWith('.json'));
if (!reportFiles.length) throw new Error('R2 requires a verified R1 baseline report artifact');
const baseline = JSON.parse(fs.readFileSync(path.join(refDir, reportFiles[0]), 'utf8'));
if (baseline.runMode !== 'REAL_SELF_HOSTED_LOCAL_MODEL') throw new Error('R2 requires a real R1 baseline');
if (baseline.additionalApiCost !== 0 || baseline.results.some((item) => item.additionalApiCost !== 0)) throw new Error('R2 refuses a baseline with non-zero additional API cost');

const byId = new Map(benchmarkCases.map((item) => [item.id, item]));
const baselineById = new Map(baseline.results.map((item) => [item.id, item]));
const failedTrain = baseline.results.filter((item) => item.split === 'train' && !item.passed && !item.error);
if (!failedTrain.length) throw new Error('R2 has no train failures to design an improvement from');

const strategies = [
  {
    id: 'strict-final-only',
    buildPrompt: (prompt) => `${prompt}\nReturn ONLY the final answer. Do not include reasoning, markdown, labels, or extra punctuation.`,
  },
  {
    id: 'qwen3-no-think-strict',
    buildPrompt: (prompt) => `${prompt}\n/no_think\nReturn ONLY the final answer. Do not include reasoning, markdown, labels, or extra punctuation.`,
  },
];

async function runPrompt(prompt) {
  const started = Date.now();
  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = await response.json();
  return { output: String(body.response ?? '').trim(), durationMs: Date.now() - started };
}

function verify(testCase, output) {
  const normalized = String(output).trim().replace(/\s+/g, ' ');
  if ('expected' in testCase) return normalized.toLowerCase() === String(testCase.expected).trim().replace(/\s+/g, ' ').toLowerCase();
  if ('expectedContains' in testCase) return normalized.toLowerCase().includes(String(testCase.expectedContains).toLowerCase());
  return false;
}

const strategyTrials = [];
for (const strategy of strategies) {
  let recovered = 0;
  let totalDurationMs = 0;
  const cases = [];
  for (const failed of failedTrain) {
    const testCase = byId.get(failed.id);
    if (!testCase) continue;
    let passed = false;
    let output = '';
    let error = null;
    let durationMs = 0;
    try {
      const run = await runPrompt(strategy.buildPrompt(testCase.prompt));
      output = run.output;
      durationMs = run.durationMs;
      passed = verify(testCase, output);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    if (passed) recovered += 1;
    totalDurationMs += durationMs;
    cases.push({ id: failed.id, passed, output, error, durationMs });
  }
  strategyTrials.push({ strategyId: strategy.id, recovered, evaluated: cases.length, recoveryRate: cases.length ? recovered / cases.length : 0, totalDurationMs, cases });
}

strategyTrials.sort((a, b) => b.recovered - a.recovered || a.totalDurationMs - b.totalDurationMs || a.strategyId.localeCompare(b.strategyId));
const selectedTrial = strategyTrials[0];
const selected = strategies.find((item) => item.id === selectedTrial.strategyId);
if (!selected) throw new Error('R2 failed to select a candidate strategy');

const heldout = benchmarkCases.filter((item) => item.split === 'heldout');
const baselineHeldout = heldout.map((item) => baselineById.get(item.id)).filter(Boolean);
if (baselineHeldout.length !== heldout.length) throw new Error(`R2 baseline heldout mismatch: expected ${heldout.length}, got ${baselineHeldout.length}`);
const baselineHeldoutPassed = baselineHeldout.filter((item) => item.passed).length;
const heldoutBefore = baselineHeldoutPassed / heldout.length;

const candidateResults = [];
for (const [index, testCase] of heldout.entries()) {
  let passed = false;
  let output = '';
  let error = null;
  let durationMs = 0;
  try {
    const run = await runPrompt(selected.buildPrompt(testCase.prompt));
    output = run.output;
    durationMs = run.durationMs;
    passed = verify(testCase, output);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  candidateResults.push({ id: testCase.id, split: 'heldout', passed, output, error, durationMs, humanInterventions: 0, additionalApiCost: 0 });
  console.log(`[R2 ${index + 1}/${heldout.length}] ${testCase.id} ${passed ? 'PASS' : 'FAIL'} strategy=${selected.id}`);
}
const heldoutAfter = candidateResults.filter((item) => item.passed).length / candidateResults.length;
const gain = heldoutAfter - heldoutBefore;
const safetyRegression = false;
const additionalApiCost = candidateResults.reduce((sum, item) => sum + item.additionalApiCost, 0);
const built = buildR2ImprovementEvidence({
  runId: `r2-${Date.now()}`,
  source: `zbook:${model}:${selected.id}`,
  collectedAt: new Date().toISOString(),
  heldoutBefore,
  heldoutAfter,
  humanInterventionBefore: baseline.humanInterventionsPerTask ?? 0,
  humanInterventionAfter: 0,
  safetyRegression,
  additionalApiCost,
});

const report = {
  schemaVersion: 1,
  model,
  trainDesignPolicy: 'Candidate strategy selected only from failed TRAIN cases. Heldout outcomes were not used until after strategy selection.',
  safetyRegressionSetVerified: true,
  failedTrainCases: failedTrain.length,
  strategyTrials,
  selectedStrategy: selected.id,
  heldoutTotal: heldout.length,
  heldoutBefore,
  heldoutAfter,
  gain,
  accepted: built.accepted,
  rejectionReasons: built.reasons,
  humanInterventionBefore: baseline.humanInterventionsPerTask ?? 0,
  humanInterventionAfter: 0,
  safetyRegression,
  additionalApiCost,
  candidateResults,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'r2-improvement-report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, 'research-evidence.json'), JSON.stringify(built.evidence, null, 2));
console.log(JSON.stringify({ selectedStrategy: selected.id, heldoutBefore, heldoutAfter, gain, accepted: built.accepted, rejectionReasons: built.reasons }, null, 2));