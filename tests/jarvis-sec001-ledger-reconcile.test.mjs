import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const ROOT = process.cwd();
const COPY_EXCLUDES = new Set(['.git', '.next', '.autonomy-state', 'node_modules']);
const REQUIREMENT_ID = 'SEC-001';
const VERIFIED_COMMIT = '2c877d9d98079888b6a019bdbe53b32469880607';
const EVIDENCE_IDS = [
  'SEC001-899-CODE',
  'SEC001-899-UNIT',
  'SEC001-899-INTEGRATION',
  'SEC001-899-SECURITY',
];

test('issue #899 reconciliation updates only SEC-001 and stays mirror-validator clean', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-899-'));
  try {
    fs.cpSync(ROOT, tmp, {
      recursive: true,
      filter(source) {
        if (source === ROOT) return true;
        const relative = path.relative(ROOT, source);
        return !relative.split(path.sep).some(segment => COPY_EXCLUDES.has(segment));
      },
    });

    const matrixPath = path.join(tmp, 'docs/jarvis-requirements.json');
    const before = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
    const beforeOtherRequirements = before.requirements
      .filter(row => row.id !== REQUIREMENT_ID)
      .map(row => JSON.parse(JSON.stringify(row)));

    execFileSync(process.execPath, ['scripts/reconcile-issue-899-sec001.mjs'], { cwd: tmp, stdio: 'pipe' });
    execFileSync(process.execPath, ['scripts/validate-jarvis-requirements.mjs'], { cwd: tmp, stdio: 'pipe' });

    const after = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
    const row = after.requirements.find(candidate => candidate.id === REQUIREMENT_ID);
    assert.ok(row);
    assert.equal(row.status, 'VERIFIED');
    assert.equal(row.blocker, null);
    assert.equal(row.last_verified_commit, VERIFIED_COMMIT);
    assert.deepEqual(row.required_evidence, ['CODE', 'UNIT', 'INTEGRATION', 'SECURITY']);
    assert.deepEqual(row.evidence_refs, EVIDENCE_IDS);
    assert.ok(row.test_refs.includes('tests/owner-auth.test.ts'));
    assert.ok(row.test_refs.includes('tests/jarvis-sec001-owner-auth-integration.test.ts'));

    const afterOtherRequirements = after.requirements
      .filter(candidate => candidate.id !== REQUIREMENT_ID)
      .map(candidate => JSON.parse(JSON.stringify(candidate)));
    assert.deepEqual(afterOtherRequirements, beforeOtherRequirements);

    const records = after.evidence_records.filter(record => record.id.startsWith('SEC001-899-'));
    assert.deepEqual(records.map(record => record.id), EVIDENCE_IDS);
    assert.deepEqual(records.map(record => record.class), ['CODE', 'UNIT', 'INTEGRATION', 'SECURITY']);
    assert.ok(records.every(record => record.result === 'PASS'));
    assert.ok(records.every(record => record.commit === VERIFIED_COMMIT));
    assert.ok(records.every(record => record.requirement_ids.length === 1 && record.requirement_ids[0] === REQUIREMENT_ID));

    const evidence = fs.readFileSync(path.join(tmp, 'docs/evidence/899-sec001-owner-auth.md'), 'utf8');
    assert.match(evidence, /No device app\/version, enrollment, secret, credential, permission, firewall, billing/);
    assert.match(evidence, /does not claim `PHYSICAL`, `RECOVERY`, independent-audit, or AGI evidence/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
