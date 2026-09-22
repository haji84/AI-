import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BASELINE_MAIN,
  EVIDENCE_SOURCE,
  IMPLEMENTATION_REFS,
  TEST_REFS,
  reconcileUi007,
} from '../scripts/reconcile-issue-1191-ui007.mjs';

function fixture(requiredEvidence = ['CODE', 'UNIT', 'INTEGRATION', 'PHYSICAL']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ui007-'));
  const write = (relative, content = '') => {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, 'utf8');
  };

  for (const ref of [...IMPLEMENTATION_REFS, ...TEST_REFS]) write(ref, '// fixture\n');
  write(EVIDENCE_SOURCE, '# evidence\n');
  const initialRow = {
    id: 'UI-007',
    title: '20以上のtheme/persona preset',
    description: '20以上のtheme/persona preset。',
    phase: 'P5',
    required_evidence: requiredEvidence,
    implementation_refs: [],
    test_refs: [],
    evidence_refs: [],
    status: 'MISSING',
    blocker: 'stale',
    platform_limit: null,
    fallback: null,
    next_action: 'stale',
    last_verified_commit: null,
    delivery_audit: {
      main_revision: '278d17c28528476f12bc6f9b8d5221ea340686b9',
      implementation: 'NO_CODE_MAPPED',
      connection: 'RUNTIME_ACCEPTANCE_REQUIRED',
      physical: 'PENDING',
      staged_revision: '6af365ceb1b52b9111f98760da8d352449632871',
      staged_implementation_refs: [],
      audit_ref: 'docs/evidence/1188-requirements-windows.md',
    },
  };
  write('docs/jarvis-requirements.json', `${JSON.stringify({ schema_version: 1, requirements: [initialRow], evidence_records: [] }, null, 2)}\n`);
  write('docs/JARVIS_PRODUCT_SPEC.md', `# Fixture\n\n### UI-007\n\n\`\`\`json\n${JSON.stringify(initialRow, null, 2)}\n\`\`\`\n\n### UI-008\n`);
  return root;
}

test('UI-007 reconciler maps existing presets conservatively and keeps PHYSICAL pending', () => {
  const root = fixture();
  try {
    const row = reconcileUi007({ root });
    assert.equal(row.status, 'PARTIAL');
    assert.deepEqual(row.implementation_refs, [...IMPLEMENTATION_REFS]);
    assert.deepEqual(row.test_refs, [...TEST_REFS]);
    assert.deepEqual(row.evidence_refs, [EVIDENCE_SOURCE]);
    assert.equal(row.last_verified_commit, null);
    assert.equal(row.delivery_audit.main_revision, BASELINE_MAIN);
    assert.equal(row.delivery_audit.implementation, 'MAIN_CODE_PRESENT');
    assert.equal(row.delivery_audit.connection, 'RUNTIME_ACCEPTANCE_REQUIRED');
    assert.equal(row.delivery_audit.physical, 'PENDING');
    assert.equal(row.delivery_audit.audit_ref, EVIDENCE_SOURCE);
    assert.equal(row.delivery_audit.staged_revision, '6af365ceb1b52b9111f98760da8d352449632871');

    const matrix = JSON.parse(fs.readFileSync(path.join(root, 'docs/jarvis-requirements.json'), 'utf8'));
    assert.deepEqual(matrix.requirements[0], row);
    const spec = fs.readFileSync(path.join(root, 'docs/JARVIS_PRODUCT_SPEC.md'), 'utf8');
    const block = [...spec.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(match => JSON.parse(match[1]));
    assert.deepEqual(block, [row]);

    const beforeSecondRun = {
      matrix: fs.readFileSync(path.join(root, 'docs/jarvis-requirements.json'), 'utf8'),
      spec: fs.readFileSync(path.join(root, 'docs/JARVIS_PRODUCT_SPEC.md'), 'utf8'),
    };
    reconcileUi007({ root });
    assert.equal(fs.readFileSync(path.join(root, 'docs/jarvis-requirements.json'), 'utf8'), beforeSecondRun.matrix);
    assert.equal(fs.readFileSync(path.join(root, 'docs/JARVIS_PRODUCT_SPEC.md'), 'utf8'), beforeSecondRun.spec);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UI-007 reconciler fails closed if the evidence contract changes', () => {
  const root = fixture(['CODE', 'UNIT', 'INTEGRATION']);
  try {
    assert.throws(
      () => reconcileUi007({ root }),
      /evidence contract changed; refusing reconciliation/,
    );
    const matrix = JSON.parse(fs.readFileSync(path.join(root, 'docs/jarvis-requirements.json'), 'utf8'));
    assert.equal(matrix.requirements[0].status, 'MISSING');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
