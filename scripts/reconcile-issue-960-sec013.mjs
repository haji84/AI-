import fs from 'node:fs';

const REQUIREMENT_ID = 'SEC-013';
const VERIFIED_COMMIT = '6221ad5f04167c9a3de3d2dc38991e04ea4f0a49';
const EVIDENCE_SOURCE = 'docs/evidence/960-sec013-no-silent-paid-api.md';
const VERIFIER = 'GitHub Actions main CI #1423 (run 35560762889)';
const TIMESTAMP = '2026-09-21T04:23:55Z';
const EVIDENCE = [
  ['SEC013-960-CODE', 'CODE'],
  ['SEC013-960-UNIT', 'UNIT'],
  ['SEC013-960-INTEGRATION', 'INTEGRATION'],
  ['SEC013-960-SECURITY', 'SECURITY'],
];

const matrixPath = 'docs/jarvis-requirements.json';
const specPath = 'docs/JARVIS_PRODUCT_SPEC.md';
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const row = matrix.requirements.find(candidate => candidate.id === REQUIREMENT_ID);
if (!row) throw new Error(`missing ${REQUIREMENT_ID}`);

const expectedEvidence = ['CODE', 'UNIT', 'INTEGRATION', 'SECURITY'];
if (row.required_evidence.join(',') !== expectedEvidence.join(',')) {
  throw new Error(`${REQUIREMENT_ID}: evidence contract changed`);
}

row.implementation_refs = [
  'src/jarvis/policy-engine.ts',
  'src/orchestrator/goal-loop.ts',
];
row.test_refs = [
  'tests/jarvis-sec013-no-silent-paid-api.test.ts',
  'tests/no-paid-ai-runtime.test.ts',
  'tests/jarvis-p8-security-suite-contract.test.mjs',
];
row.evidence_refs = EVIDENCE.map(([evidenceId]) => evidenceId);
row.status = 'VERIFIED';
row.blocker = null;
row.platform_limit = null;
row.fallback = null;
row.next_action = 'Maintain fail-closed no-paid-default and P8 regression coverage; reopen if paid routing can occur without an explicit Human Gate.';
row.last_verified_commit = VERIFIED_COMMIT;

matrix.evidence_records = (matrix.evidence_records ?? []).filter(record => !record.id.startsWith('SEC013-960-'));
for (const [id, evidenceClass] of EVIDENCE) {
  matrix.evidence_records.push({
    id,
    requirement_ids: [REQUIREMENT_ID],
    class: evidenceClass,
    result: 'PASS',
    commit: VERIFIED_COMMIT,
    source: EVIDENCE_SOURCE,
    verifier: VERIFIER,
    timestamp: TIMESTAMP,
  });
}
fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);

let spec = fs.readFileSync(specPath, 'utf8');
const replacement = `### ${REQUIREMENT_ID}\n\n\`\`\`json\n${JSON.stringify(row, null, 2)}\n\`\`\``;
const pattern = new RegExp(`### ${REQUIREMENT_ID}\\r?\\n\\r?\\n\`\`\`json\\r?\\n[\\s\\S]*?\\r?\\n\`\`\``, 'm');
if (!pattern.test(spec)) throw new Error(`canonical block missing for ${REQUIREMENT_ID}`);
spec = spec.replace(pattern, replacement);
fs.writeFileSync(specPath, spec);

if (!fs.existsSync(EVIDENCE_SOURCE)) throw new Error(`missing evidence source ${EVIDENCE_SOURCE}`);
