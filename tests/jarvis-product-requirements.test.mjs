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

test('all 340 preserved and expanded owner requirements have exact canonical mapping', () => {
  assert.equal(source.requirements.length, 340);
  assert.deepEqual(validateRequirements(source, ledger, root), []);
});

test('source crosswalk preserves original inventory and maps all owner/addendum sections', () => {
  const crosswalk = JSON.parse(fs.readFileSync(new URL('../docs/jarvis-spec-crosswalk.json', import.meta.url), 'utf8'));
  const ids = new Set(source.requirements.map(r => r.id));
  assert.equal(crosswalk.preserved_ids.length, 244);
  assert.equal(new Set(crosswalk.preserved_ids).size, 244);
  for (const id of crosswalk.preserved_ids) assert.ok(ids.has(id), id);
  assert.deepEqual(crosswalk.sections.map(r => r.section), Array.from({length:68}, (_,i)=>i));
  for (const row of crosswalk.sections) {
    assert.ok(row.requirement_ids.length || row.governance_refs.length);
    for (const id of row.requirement_ids) assert.ok(ids.has(id), id);
  }
  assert.deepEqual(crosswalk.addendum.map(r=>r.section), Array.from({length:28}, (_,i)=>i+103));
  const addendum = fs.readFileSync(new URL('../docs/JARVIS_SPEC_ADDENDUM.md', import.meta.url), 'utf8');
  const sections = [...addendum.matchAll(/^### (1\d\d)\. (.+)\r?\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)];
  assert.equal(sections.length, 28);
  for (let i=0; i<sections.length; i++) {
    const row = source.requirements.find(r=>r.id===crosswalk.addendum[i].requirement_id);
    assert.equal(row.description, sections[i][3].trim(), `addendum ${sections[i][1]} must not be abridged`);
  }
});

test('migration cannot drop physical evidence and production controls cannot drop security evidence', () => {
  for (const [id, kind] of [['MIG-020','PHYSICAL'], ['GOV-001','SECURITY']]) {
    const data = structuredClone(source);
    data.requirements.find(r=>r.id===id).required_evidence = ['CODE','UNIT'];
    assert.ok(validateRequirements(data, mirror(data), root).some(error=>error.includes(`${id}: ${kind} evidence may not be removed`)));
  }
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
