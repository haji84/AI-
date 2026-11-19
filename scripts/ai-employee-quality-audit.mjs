import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUSES = new Set(['PASS', 'FAIL', 'UNVERIFIED']);
const GATES = ['failure_reproduced', 'cause_supported', 'regression_passed', 'exact_revision_ci', 'live_goal_verified'];
const DEFAULT_PATH = 'docs/evidence/1216-20261119-ai-employee-quality-cases.json';

function validEvidence(entry, caseId, arm, gate) {
  assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), `${caseId}/${arm}/${gate}: missing entry`);
  assert.ok(STATUSES.has(entry.status), `${caseId}/${arm}/${gate}: invalid status`);
  if (entry.status !== 'UNVERIFIED') {
    assert.ok(typeof entry.evidence === 'string' && /^https:\/\/github\.com\/haji84\/AI-\//.test(entry.evidence),
      `${caseId}/${arm}/${gate}: grounded GitHub evidence URL required`);
  } else {
    assert.ok(entry.evidence === null || entry.evidence === undefined, `${caseId}/${arm}/${gate}: unverifiable evidence claim`);
  }
  return entry.status;
}

function score(snapshot, caseId, arm) {
  assert.ok(snapshot && typeof snapshot === 'object', `${caseId}/${arm}: missing snapshot`);
  assert.deepEqual(Object.keys(snapshot.checks ?? {}).sort(), [...GATES].sort(), `${caseId}/${arm}: checks mismatch`);
  const statuses = Object.fromEntries(GATES.map(g => [g, validEvidence(snapshot.checks[g], caseId, arm, g)]));
  assert.ok(snapshot.goalStatus === 'NOT_ACHIEVED' || snapshot.goalStatus === 'ACHIEVED', `${caseId}/${arm}: invalid goal state`);
  if (snapshot.goalStatus === 'ACHIEVED') {
    assert.equal(statuses.live_goal_verified, 'PASS', `${caseId}/${arm}: source CI is not goal completion`);
  }
  const corrections = snapshot.manualCorrections;
  assert.ok(corrections === null || (Number.isSafeInteger(corrections) && corrections >= 0), `${caseId}/${arm}: unknown corrections must be null`);
  const passed = GATES.filter(g => statuses[g] === 'PASS').length;
  return { passed, total: GATES.length, failed: GATES.filter(g => statuses[g] === 'FAIL').length,
    unverified: GATES.filter(g => statuses[g] === 'UNVERIFIED').length, manualCorrections: corrections,
    goalStatus: snapshot.goalStatus, statuses };
}

export function evaluateQualityCampaign(data) {
  assert.equal(data?.schemaVersion, 1, 'unsupported schemaVersion');
  assert.equal(data?.measurement, 'historical_code_checkpoints_not_model_ab', 'no simulated cases represented as AI performance');
  assert.ok(Array.isArray(data.cases) && data.cases.length >= 1, 'case list empty');
  const seen = new Set();
  const cases = data.cases.map(item => {
    assert.ok(typeof item.id === 'string' && item.id.trim(), 'case ID required');
    assert.ok(!seen.has(item.id), `duplicate case ID ${item.id}`); seen.add(item.id);
    assert.ok(item.issue === 1219, `${item.id}: must remain scoped to original Goal issue`);
    assert.ok(Array.isArray(item.sources) && item.sources.length > 0 && item.sources.every(u => /^https:\/\/github\.com\/haji84\/AI-\//.test(u)), `${item.id}: source links required`);
    const before = score(item.before, item.id, 'before');
    const after = score(item.after, item.id, 'after');
    assert.equal(before.goalStatus, 'NOT_ACHIEVED', `${item.id}: historical goal not achieved`);
    assert.equal(after.goalStatus, 'NOT_ACHIEVED', `${item.id}: current Goal completion unproven`);
    return { id: item.id, task: item.task, before, after,
      deltaPassedGates: after.passed - before.passed,
      deltaManualCorrections: before.manualCorrections === null || after.manualCorrections === null
        ? null : after.manualCorrections - before.manualCorrections,
      sources: item.sources };
  });
  const sum = (key, arm) => cases.reduce((n, c) => n + c[arm][key], 0);
  return { measurement: data.measurement, caseCount: cases.length,
    gateChecks: cases.length * GATES.length, beforePassed: sum('passed', 'before'), afterPassed: sum('passed', 'after'),
    correctionReductionMeasured: cases.every(c => c.deltaManualCorrections !== null),
    liveGoalVerified: cases.some(c => c.after.goalStatus === 'ACHIEVED'), cases };
}

export function formatReport(report) {
  const lines = [
    '# AI社員・過去事例の品質ゲート比較',
    '注意: これは既存GitHub証拠による修正前後の記録照合であり、AI社員モデルのA/B実測ではありません。',
    `対象 ${report.caseCount} 件、根拠付きゲートPASS ${report.beforePassed}/${report.gateChecks} → ${report.afterPassed}/${report.gateChecks}。`,
    `本人の手直し削減: ${report.correctionReductionMeasured ? '測定済み' : '未測定（元記録に件数がない）'}。`,
    `本番Goal達成: ${report.liveGoalVerified ? '確認済み' : '未確認 / NOT_ACHIEVED'}。`,
  ];
  for (const c of report.cases) lines.push(`- ${c.id}: ${c.before.passed}/${c.before.total} → ${c.after.passed}/${c.after.total}、手直し差分 ${c.deltaManualCorrections ?? '不明'}`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? DEFAULT_PATH;
  const report = evaluateQualityCampaign(JSON.parse(readFileSync(path, 'utf8')));
  process.stdout.write(`${formatReport(report)}\n`);
}
