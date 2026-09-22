import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { reconcileUi007 } from '../scripts/reconcile-issue-1191-ui007.mjs';

const matrixPath = 'docs/jarvis-requirements.json';
const specPath = 'docs/JARVIS_PRODUCT_SPEC.md';
const fromHead = (path) => execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' });

fs.writeFileSync(matrixPath, fromHead(matrixPath), 'utf8');
fs.writeFileSync(specPath, fromHead(specPath), 'utf8');
const row = reconcileUi007();
const validation = execFileSync(process.execPath, ['scripts/validate-jarvis-requirements.mjs'], { encoding: 'utf8' });

test('issue 1191 bounded UI-007 canonical reconciliation', () => {
  assert.ok(validation.includes(`"status":"PASS"`));
  assert.equal(row.id, 'UI-007');
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.delivery_audit.physical, 'PENDING');
  assert.equal(row.last_verified_commit, null);
  assert.deepEqual(row.implementation_refs, [
    'src/app/jarvis/ui-preferences.ts',
    'src/app/jarvis/settings/JarvisLocalSettings.tsx',
    'src/app/jarvis/themes.css',
  ]);
  assert.deepEqual(row.test_refs, ['tests/jarvis-p5-customization-presets.test.mjs']);
  const after = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const mirrored = after.requirements.find((candidate) => candidate.id === 'UI-007');
  assert.deepEqual(mirrored, row);
});
