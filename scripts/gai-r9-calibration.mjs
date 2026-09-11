import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { benchmarkCases } from '../benchmarks/internal/v1_1/suite.mjs';
import { verifyTypedBenchmark } from '../src/gai/typed-benchmark-verifier.ts';
import { evaluateCalibration } from '../src/gai/world-model-calibration.ts';
import { buildR9CalibrationEvidence } from '../src/gai/research-stage-evidence.ts';

const endpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT || '';
const model = process.env.GAI_LOCAL_MODEL_NAME || '';
const outDir = path.resolve('.gai-results');
const realRun = process.argv.includes('--real');
const fail = (message) => { console.error(`R9_REFUSED: ${message}`); process.exit(2); };

if (!realRun) fail('R9 calibration requires a real self-hosted model run');
if (!process.env.RUNNER_NAME) fail('R9 requires GitHub self-hosted runner context');
if (!endpoint || !model) fail('R9 requires local model endpoint and model name');
fs.mkdirSync(outDir, { recursive: true });

const heldout = benchmarkCases.filter((item) => item.split === 'heldout');
if (heldout.length < 20) fail(`R9 requires at least 20 heldout cases; got ${heldout.length}`);

async function generate(testCase) {
  const prompt = `${testCase.prompt}\nReturn JSON only with keys answer and confidence. confidence must be a number from 0 to 1 representing your probability that answer is correct.`;
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0 } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = await response.json();
  const parsed = JSON.parse(String(body.response ?? '{}'));
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('invalid confidence');
  return { answer: String(parsed.answer ?? '').trim(), confidence };
}

const observations = [];
const results = [];
for (const [index, testCase] of heldout.entries()) {
  const started = Date.now();
  let answer = '';
  let confidence = 0;
  let error = null;
  try {
    const generated = await generate(testCase);
    answer = generated.answer;
    confidence = generated.confidence;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const occurred = !error && verifyTypedBenchmark(testCase.verifier, answer);
  if (!error) observations.push({ id: testCase.id, confidence, occurred });
  results.push({ id: testCase.id, occurred, confidence, answer, error, durationMs: Date.now() - started, additionalApiCost: 0 });
  console.log(`[R9 ${index + 1}/${heldout.length}] ${testCase.id} ${occurred ? 'PASS' : 'FAIL'} confidence=${confidence.toFixed(3)}${error ? ` error=${error}` : ''}`);
}

if (observations.length < 10) fail(`too few valid calibration observations: ${observations.length}`);
const calibration = evaluateCalibration(observations, 5);
const runId = `r9-${Date.now()}`;
const built = buildR9CalibrationEvidence({
  runId,
  source: `zbook:${process.env.RUNNER_NAME}:${model}`,
  collectedAt: new Date().toISOString(),
  observations: calibration.count,
  brierScore: calibration.brierScore,
  expectedCalibrationError: calibration.expectedCalibrationError,
  heldoutEvaluated: true,
});
if (!built.accepted) fail(`R9 evidence rejected: ${built.reasons.join('; ')}`);

const report = {
  schemaVersion: 1,
  runId,
  runner: process.env.RUNNER_NAME,
  host: os.hostname(),
  model,
  heldoutTotal: heldout.length,
  validObservations: calibration.count,
  brierScore: calibration.brierScore,
  expectedCalibrationError: calibration.expectedCalibrationError,
  additionalApiCost: 0,
  bins: calibration.bins,
  results,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'r9-calibration-report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, 'research-evidence.json'), JSON.stringify(built.evidence, null, 2));
console.log(JSON.stringify({ validObservations: calibration.count, brierScore: calibration.brierScore, expectedCalibrationError: calibration.expectedCalibrationError }, null, 2));