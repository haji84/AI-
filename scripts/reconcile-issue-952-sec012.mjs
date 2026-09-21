import fs from 'node:fs';

const REQUIREMENT_ID = 'SEC-012';
const VERIFIED_COMMIT = 'de95421055abd30e700c1da16c2ff82a53fff555';
const EVIDENCE_SOURCE = 'docs/evidence/952-sec012-no-secrets-logs.md';
const VERIFIER = 'GitHub Actions main CI #1399 (run 35556813708)';
const TIMESTAMP = '2026-09-21T03:14:48Z';
const EVIDENCE = [
  ['SEC012-952-CODE', 'CODE'],
  ['SEC012-952-UNIT', 'UNIT'],
  ['SEC012-952-INTEGRATION', 'INTEGRATION'],
  ['SEC012-952-SECURITY', 'SECURITY'],
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

row.implementation_refs = ['scripts/jarvis-secret-audit.mjs'];
row.test_refs = [
  'tests/jarvis-sec012-no-secrets-logs.test.mjs',
  'tests/jarvis-secret-audit.test.mjs',
  'tests/jarvis-p8-security-suite-contract.test.mjs',
];
row.evidence_refs = EVIDENCE.map(([evidenceId]) => evidenceId);
row.status = 'VERIFIED';
row.blocker = null;
row.platform_limit = null;
row.fallback = null;
row.next_action = 'Maintain secret-safe logging and P8 regression coverage; reopen if sensitive values can reach logs or audit findings expose secret material.';
row.last_verified_commit = VERIFIED_COMMIT;

matrix.evidence_records = (matrix.evidence_records ?? []).filter(record => !record.id.startsWith('SEC012-952-'));
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
