import fs from 'node:fs';
import path from 'node:path';
import { decideExperiment } from '../src/gai/research-loop.ts';
import { buildR16ResearchLoopEvidence } from '../src/gai/research-stage-evidence.ts';

const outDir = path.resolve('.gai-results');
fs.mkdirSync(outDir, { recursive: true });

const cases = Object.freeze([
  { id: 'n1', expected: '42', observed: '42' },
  { id: 'n2', expected: 'PASS', observed: ' PASS ' },
  { id: 'n3', expected: 'alpha>beta', observed: 'alpha>beta\n' },
  { id: 'n4', expected: 'K07M49', observed: '**K07M49**' },
  { id: 'n5', expected: 'RIGHT05:LEFT05', observed: 'RIGHT05:LEFT05' },
  { id: 'n6', expected: 'arr.reduce((a,b)=>a+b,0)', observed: '```js\narr.reduce((a,b)=>a+b,0)\n```' },
  { id: 'n7', expected: 'string[]', observed: 'string[]' },
  { id: 'n8', expected: 'NO', observed: 'NO.' },
]);

const baselineNormalize = (value) => String(value).trim();
const conservativeNormalize = (value) => String(value).trim().replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/i, '').replace(/^\*\*(.*)\*\*$/s, '$1').replace(/[.]$/, '');
const overAggressiveNormalize = (value) => String(value).replace(/[^A-Za-z]/g, '').toLowerCase();

function score(normalize) {
  return cases.filter((item) => normalize(item.observed).toLowerCase() === normalize(item.expected).toLowerCase()).length / cases.length;
}

function runCycle() {
  const before = score(baselineNormalize);
  const candidates = [
    { id: 'hypothesis:conservative-output-normalization', normalize: conservativeNormalize },
    { id: 'hypothesis:over-aggressive-output-normalization', normalize: overAggressiveNormalize },
  ];
  return candidates.map((candidate, index) => {
    const after = score(candidate.normalize);
    const experiment = decideExperiment({
      id: `r16-exp-${index + 1}`,
      hypothesisId: candidate.id,
      benchmarkBefore: before,
      benchmarkAfter: after,
      humanInterventionBefore: 0,
      humanInterventionAfter: 0,
      additionalApiCost: 0,
      safetyRegression: false,
    });
    return { hypothesisId: candidate.id, before, after, gain: after - before, decision: experiment.decision, reason: experiment.reason };
  });
}

const first = runCycle();
const second = runCycle();
const reproducible = JSON.stringify(first) === JSON.stringify(second);
if (!reproducible) throw new Error('R16 repeated sandbox cycle was not reproducible');
const accepted = first.filter((item) => item.decision === 'accepted').length;
const rejected = first.filter((item) => item.decision === 'rejected').length;
if (accepted === 0 || rejected === 0) throw new Error('R16 must demonstrate both accept and reject decisions');

const runId = `r16-${Date.now()}`;
const built = buildR16ResearchLoopEvidence({
  runId,
  source: 'hosted-sandbox:deterministic-output-normalization',
  collectedAt: new Date().toISOString(),
  hypothesesTested: first.length,
  accepted,
  rejected,
  reproducible,
});
if (!built.accepted) throw new Error(`R16 evidence rejected: ${built.reasons.join('; ')}`);

const report = {
  schemaVersion: 1,
  policy: 'Bounded deterministic sandbox experiment. No production mutation, no heldout training, no paid API.',
  cases: cases.length,
  firstCycle: first,
  secondCycle: second,
  reproducible,
  accepted,
  rejected,
  additionalApiCost: 0,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'r16-research-loop-report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, 'research-evidence.json'), JSON.stringify(built.evidence, null, 2));
console.log(JSON.stringify({ hypothesesTested: first.length, accepted, rejected, reproducible }, null, 2));
