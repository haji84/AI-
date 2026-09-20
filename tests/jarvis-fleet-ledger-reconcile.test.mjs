import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const ROOT = process.cwd();
const TARGET_IDS = ['FLEET-010', 'FLEET-011'];
const COPY_EXCLUDES = new Set(['.git', '.next', '.autonomy-state', 'node_modules']);

test('issue #725 reconciliation is atomic, validator-clean, and does not certify physical fleet rows', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-725-'));
  try {
    fs.cpSync(ROOT, tmp, {
      recursive: true,
      filter(source) {
        if (source === ROOT) return true;
        const relative = path.relative(ROOT, source);
        return !relative.split(path.sep).some(segment => COPY_EXCLUDES.has(segment));
      },
    });

    const before = JSON.parse(fs.readFileSync(path.join(tmp, 'docs/jarvis-requirements.json'), 'utf8'));
    const beforeFleet009 = JSON.parse(JSON.stringify(before.requirements.find(row => row.id === 'FLEET-009')));

    execFileSync(process.execPath, ['scripts/reconcile-issue-725-fleet.mjs'], { cwd: tmp, stdio: 'pipe' });
    execFileSync(process.execPath, ['scripts/validate-jarvis-requirements.mjs'], { cwd: tmp, stdio: 'pipe' });

    const after = JSON.parse(fs.readFileSync(path.join(tmp, 'docs/jarvis-requirements.json'), 'utf8'));
    const byId = new Map(after.requirements.map(row => [row.id, row]));

    assert.deepEqual(byId.get('FLEET-009'), beforeFleet009);
    for (const id of TARGET_IDS) {
      const row = byId.get(id);
      assert.equal(row.status, 'VERIFIED');
      assert.equal(row.blocker, null);
      assert.equal(row.last_verified_commit, '6a2be422b1a5de793a6b0e522b35e678aa5aba53');
      assert.deepEqual(row.required_evidence, ['CODE', 'UNIT', 'INTEGRATION']);
      assert.deepEqual(row.evidence_refs, ['FLEET725-CODE', 'FLEET725-UNIT', 'FLEET725-INTEGRATION']);
    }

    const records = after.evidence_records.filter(record => record.id.startsWith('FLEET725-'));
    assert.deepEqual(records.map(record => record.class).sort(), ['CODE', 'INTEGRATION', 'UNIT']);
    assert.ok(records.every(record => record.result === 'PASS'));
    assert.ok(records.every(record => record.commit === '6a2be422b1a5de793a6b0e522b35e678aa5aba53'));
    assert.ok(records.every(record => TARGET_IDS.every(id => record.requirement_ids.includes(id))));

    const committedEvidence = fs.readFileSync(path.join(ROOT, 'docs/evidence/725-fleet-capacity.md'), 'utf8');
    const generatedEvidence = fs.readFileSync(path.join(tmp, 'docs/evidence/725-fleet-capacity.md'), 'utf8');
    assert.equal(generatedEvidence, committedEvidence);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
