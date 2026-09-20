import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

const verifiedCommit = '6a2be422b1a5de793a6b0e522b35e678aa5aba53';
const verifiedAt = '2026-09-20T16:44:00Z';
const targetIds = new Set(['FLEET-010', 'FLEET-011']);
const evidenceIds = ['FLEET725-CODE', 'FLEET725-UNIT', 'FLEET725-INTEGRATION'];
const matrixPath = 'docs/jarvis-requirements.json';
const specPath = 'docs/JARVIS_PRODUCT_SPEC.md';
const fromHead = (path) => execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' });

const matrix = JSON.parse(fromHead(matrixPath));
const rows = new Map(matrix.requirements.map((row) => [row.id, row]));
for (const id of targetIds) {
  const row = rows.get(id);
  assert.ok(row, `missing ${id}`);
  row.evidence_refs = [...evidenceIds];
  row.status = 'VERIFIED';
  row.blocker = null;
  row.platform_limit = null;
  row.fallback = null;
  row.next_action = 'Maintain the 100-node capacity and fail-closed overflow regression; reopen if the fleet capacity boundary changes.';
  row.last_verified_commit = verifiedCommit;
}
const evidenceRecords = [
  ['FLEET725-CODE', 'CODE'],
  ['FLEET725-UNIT', 'UNIT'],
  ['FLEET725-INTEGRATION', 'INTEGRATION'],
].map(([id, evidenceClass]) => ({ id, requirement_ids: [...targetIds], class: evidenceClass, result: 'PASS', commit: verifiedCommit, source: 'docs/audit/jarvis-p4-capacity-evidence-2026-09-16.md', verifier: 'GitHub Actions main CI #1292 (run 35523573773)', timestamp: verifiedAt }));
matrix.evidence_records = [...(matrix.evidence_records ?? []).filter((record) => !evidenceIds.includes(record.id)), ...evidenceRecords];

let spec = fromHead(specPath);
const seen = new Map([...targetIds].map((id) => [id, 0]));
spec = spec.replace(/```json\r?\n([\s\S]*?)\r?\n```/g, (whole, jsonText) => {
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { return whole; }
  if (!targetIds.has(parsed?.id)) return whole;
  seen.set(parsed.id, (seen.get(parsed.id) ?? 0) + 1);
  return `\`\`\`json\n${JSON.stringify(rows.get(parsed.id), null, 2)}\n\`\`\``;
});
for (const [id, count] of seen) assert.equal(count, 1, `${id} canonical block count`);
fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
fs.writeFileSync(specPath, spec, 'utf8');
const validation = execFileSync(process.execPath, ['scripts/validate-jarvis-requirements.mjs'], { encoding: 'utf8' });

test('issue 725 bounded canonical reconciliation', () => {
  assert.match(validation, /"status":"PASS"/);
  const after = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  for (const id of targetIds) {
    const row = after.requirements.find((item) => item.id === id);
    assert.equal(row.status, 'VERIFIED');
    assert.equal(row.last_verified_commit, verifiedCommit);
    assert.deepEqual(row.evidence_refs, evidenceIds);
  }
  assert.equal(after.requirements.find((item) => item.id === 'FLEET-009').status, 'PARTIAL');
});
