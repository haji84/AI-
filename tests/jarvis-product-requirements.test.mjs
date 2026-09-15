import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { validateRequirements } from '../scripts/validate-jarvis-requirements.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(fs.readFileSync(new URL('../docs/jarvis-requirements.json', import.meta.url), 'utf8'));
const ledger = fs.readFileSync(new URL('../docs/JARVIS_PRODUCT_SPEC.md', import.meta.url), 'utf8');
const mirror = data => data.requirements.map(row => '```json\n' + JSON.stringify(row) + '\n```').join('\n');
const structuredClone = value => JSON.parse(JSON.stringify(value));

test('all 238 owner requirements have exact canonical mapping', () => {
  assert.equal(source.requirements.length, 238);
  assert.deepEqual(validateRequirements(source, ledger, root), []);
});

test('missing, duplicated, unknown and silently edited requirements fail closed', () => {
  for (const mutate of [m => m.requirements.pop(), m => m.requirements.push(m.requirements[0]), m => { m.requirements[0].id = 'NET-999'; }]) {
    const data = structuredClone(source); mutate(data);
    assert.ok(validateRequirements(data, mirror(data), root).length > 0);
  }
  const data = structuredClone(source); data.requirements[0].description = 'reduced scope';
  assert.ok(validateRequirements(data, ledger, root).includes('Canonical ledger and matrix differ'));
});

test('CI-only or unbacked PASS cannot promote physical acceptance', () => {
  const data = structuredClone(source);
  const row = data.requirements.find(item => item.id === 'ACC-001');
  row.status = 'VERIFIED'; row.blocker = null; row.last_verified_commit = 'a'.repeat(40);
  assert.ok(validateRequirements(data, mirror(data), root).some(error => error.includes('missing PHYSICAL evidence')));
  row.required_evidence = ['CODE', 'UNIT'];
  assert.ok(validateRequirements(data, mirror(data), root).some(error => error.includes('PHYSICAL evidence may not be removed')));
});

test('unimplemented fallback is not platform-limited completion', () => {
  const data = structuredClone(source);
  const row = data.requirements.find(item => item.id === 'DEV-I-008');
  row.status = 'PLATFORM_LIMITED'; row.platform_limit = { reason: 'iOS restrictions' }; row.fallback = 'view-only';
  assert.ok(validateRequirements(data, mirror(data), root).some(error => error.includes('PLATFORM_LIMITED needs')));
});

test('simulated physical evidence and missing paths are rejected', () => {
  const data = structuredClone(source);
  data.evidence_records.push({ id: 'fake', class: 'PHYSICAL', result: 'PASS', commit: 'a'.repeat(40), timestamp: '2026-09-16T00:00:00Z', source: 'test', verifier: 'test', simulated: true });
  data.requirements[0].implementation_refs = ['does-not-exist.ts'];
  const errors = validateRequirements(data, mirror(data), root);
  assert.ok(errors.some(error => error.includes('requires real device')));
  assert.ok(errors.some(error => error.includes('invalid repository reference')));
});
