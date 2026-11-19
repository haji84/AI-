import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { test } from 'node:test';
import { evaluateQualityCampaign, formatReport } from '../scripts/ai-employee-quality-audit.mjs';
const dataset = JSON.parse(readFileSync(new URL('../docs/evidence/1216-20261119-ai-employee-quality-cases.json', import.meta.url), 'utf8'));
function copy() { return JSON.parse(JSON.stringify(dataset)); }
test('historical process checks are paired and never called AI-model accuracy', () => {
  const report = evaluateQualityCampaign(copy());
  assert.equal(report.caseCount, 2);
  assert.equal(report.gateChecks, 10);
  assert.equal(report.beforePassed, 3);
  assert.equal(report.afterPassed, 7);
  assert.equal(report.correctionReductionMeasured, false);
  assert.equal(report.liveGoalVerified, false);
  assert.match(formatReport(report), /AI社員モデルのA\/B実測ではありません/);
  assert.match(formatReport(report), /未測定/);
});
test('no pass without URL-backed evidence', () => {
  const data = copy(); data.cases[0].after.checks.exact_revision_ci.evidence = null;
  assert.throws(() => evaluateQualityCampaign(data), /evidence URL required/);
});
test('unknown evidence remains explicitly unknown', () => {
  const data = copy(); data.cases[1].after.checks.cause_supported.evidence = 'https://github.com/haji84/AI-/pull/1933';
  assert.throws(() => evaluateQualityCampaign(data), /unverifiable evidence claim/);
});
test('source CI success never completes original production goal', () => {
  const data = copy(); data.cases[0].after.goalStatus = 'ACHIEVED';
  assert.throws(() => evaluateQualityCampaign(data), /source CI is not goal completion/);
});
test('missing mandatory checks and duplicate cases are rejected', () => {
  let data = copy(); delete data.cases[0].after.checks.live_goal_verified;
  assert.throws(() => evaluateQualityCampaign(data), /checks mismatch/);
  data = copy(); data.cases.push(JSON.parse(JSON.stringify(data.cases[0])));
  assert.throws(() => evaluateQualityCampaign(data), /duplicate case/);
});
test('manual corrections must be measured rather than guessed', () => {
  const data = copy(); data.cases[0].after.manualCorrections = '0';
  assert.throws(() => evaluateQualityCampaign(data), /unknown corrections must be null/);
});
test('program cannot relabel fixture scores as a real-model A/B', () => {
  const data = copy(); data.measurement = 'real_model_ab';
  assert.throws(() => evaluateQualityCampaign(data), /simulated cases/);
});
