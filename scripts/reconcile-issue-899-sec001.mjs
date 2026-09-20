import fs from 'node:fs';

const REQUIREMENT_ID = 'SEC-001';
const VERIFIED_COMMIT = '2c877d9d98079888b6a019bdbe53b32469880607';
const EVIDENCE_SOURCE = 'docs/evidence/899-sec001-owner-auth.md';
const VERIFIER = 'GitHub Actions main CI #1301 (run 35525972805)';
const TIMESTAMP = '2026-09-20T17:29:25Z';
const EVIDENCE = [
  ['SEC001-899-CODE', 'CODE'],
  ['SEC001-899-UNIT', 'UNIT'],
  ['SEC001-899-INTEGRATION', 'INTEGRATION'],
  ['SEC001-899-SECURITY', 'SECURITY'],
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

const focusedTest = 'tests/jarvis-sec001-owner-auth-integration.test.ts';
if (!row.test_refs.includes(focusedTest)) row.test_refs.push(focusedTest);
row.evidence_refs = EVIDENCE.map(([evidenceId]) => evidenceId);
row.status = 'VERIFIED';
row.blocker = null;
row.platform_limit = null;
row.fallback = null;
row.next_action = 'Maintain fail-closed Owner authentication and P8 regression coverage; reopen if the Owner login/session/Broker authentication boundary regresses.';
row.last_verified_commit = VERIFIED_COMMIT;

matrix.evidence_records = (matrix.evidence_records ?? []).filter(record => !record.id.startsWith('SEC001-899-'));
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
