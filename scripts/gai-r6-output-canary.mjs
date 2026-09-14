import fs from 'node:fs';
import path from 'node:path';
import { benchmarkCases } from '../benchmarks/internal/v1_1/suite.mjs';
import { verifyTypedBenchmark } from '../src/gai/typed-benchmark-verifier.ts';

const endpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT || 'http://127.0.0.1:11434';
const model = process.env.GAI_LOCAL_MODEL_NAME || 'qwen3:4b';
const timeoutMs = Number.parseInt(process.env.GAI_CANARY_TIMEOUT_MS || '45000', 10);
const numPredict = Number.parseInt(process.env.GAI_CANARY_NUM_PREDICT || '128', 10);
const outDir = path.resolve('.gai-canary-results');
fs.mkdirSync(outDir, { recursive: true });

const canaryIds = [
  'chain-arithmetic-001',
  'logic-001',
  'claim-check-001',
  'planning-001',
  'memory-transform-001',
  'transfer-001',
  'coding-001',
  'coding-002',
  'extraction-001',
  'extraction-002',
  'set-001',
  'routing-001',
];
const selected = canaryIds.map((id) => benchmarkCases.find((item) => item.id === id));
if (selected.some((item) => !item)) throw new Error('canary case missing from frozen suite');
if (selected.some((item) => item.split === 'heldout')) throw new Error('canary must use development/train cases only');

function contractFor(testCase) {
  if (testCase.verifier.type === 'json') {
    return 'Return valid JSON only. Preserve primitive types exactly: numeric values as JSON numbers, booleans as JSON booleans, strings as strings. No markdown or explanation.';
  }
  if (testCase.category === 'coding') {
    return 'Return only the exact requested code or type expression. No markdown fences, no commentary, no explanation.';
  }
  return 'Return only the final requested answer. No reasoning, labels, explanation, or markdown.';
}

function cleanOutput(value) {
  return String(value ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json|javascript|js|typescript|ts)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

const results = [];
for (const testCase of selected) {
  const started = Date.now();
  let output = '';
  let error = null;
  try {
    const body = {
      model,
      prompt: `${testCase.prompt}\n${contractFor(testCase)}`,
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: numPredict },
    };
    if (testCase.verifier.type === 'json') body.format = 'json';
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    output = cleanOutput(payload.response);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const durationMs = Date.now() - started;
  const passed = !error && verifyTypedBenchmark(testCase.verifier, output);
  const item = { id: testCase.id, category: testCase.category, split: testCase.split, passed, durationMs, output, error };
  results.push(item);
  console.log(`[R6-CANARY] ${item.id} pass=${passed} durationMs=${durationMs} output=${JSON.stringify(output)}`);
}

const passed = results.filter((item) => item.passed).length;
const targeted = results.filter((item) => ['coding', 'structured-extraction', 'safety-routing'].includes(item.category));
const report = {
  schemaVersion: 1,
  model,
  settings: { think: false, numPredict, timeoutMs },
  total: results.length,
  passed,
  successRate: passed / results.length,
  targetedTotal: targeted.length,
  targetedPassed: targeted.filter((item) => item.passed).length,
  targetedSuccessRate: targeted.length ? targeted.filter((item) => item.passed).length / targeted.length : 0,
  emptyOutputCount: results.filter((item) => !item.output).length,
  timeoutCount: results.filter((item) => item.error && /timeout|aborted/i.test(item.error)).length,
  averageDurationMs: results.reduce((sum, item) => sum + item.durationMs, 0) / results.length,
  results,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'r6-output-canary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
