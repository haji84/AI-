import fs from 'node:fs';

const REQUIREMENT_ID = 'SEC-014';
const VERIFIED_COMMIT = '7caf98fa8e3aca564050e229f27e4e16a93e8bc4';
const EVIDENCE_SOURCE = 'docs/evidence/964-sec014-human-gate-invariants.md';
const VERIFIER = 'GitHub Actions main CI #1428 (run 35561752961)';
const TIMESTAMP = '2026-09-21T04:39:25Z';
const EVIDENCE = [
  ['SEC014-964-CODE', 'CODE'],
  ['SEC014-964-UNIT', 'UNIT'],
  ['SEC014-964-INTEGRATION', 'INTEGRATION'],
  ['SEC014-964-SECURITY', 'SECURITY'],
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
  'src/orchestrator/risk-policy.ts',
  'src/orchestrator/delegated-approval-policy.ts',
  'src/orchestrator/task-authorization.ts',
  'src/orchestrator/goal-loop.ts',
];
row.test_refs = [
  'tests/jarvis-sec014-human-gate-invariants.test.ts',
  'tests/risk-policy.test.ts',
  'tests/task-authorization.test.ts',
  'tests/jarvis-p8-security-suite-contract.test.mjs',
];
row.evidence_refs = EVIDENCE.map(([evidenceId]) => evidenceId);
row.status = 'VERIFIED';
row.blocker = null;
row.platform_limit = null;
row.fallback = null;
row.next_action = 'Maintain fail-closed Human Gate and delegation regression coverage; reopen if protected privileged, destructive, governance, publication, or Production actions can bypass their required gate.';
row.last_verified_commit = VERIFIED_COMMIT;

matrix.evidence_records = (matrix.evidence_records ?? []).filter(record => !record.id.startsWith('SEC014-964-'));
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
