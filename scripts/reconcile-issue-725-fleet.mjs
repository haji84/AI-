import fs from 'node:fs';

const VERIFIED_COMMIT = '6a2be422b1a5de793a6b0e522b35e678aa5aba53';
const EVIDENCE_SOURCE = 'docs/evidence/725-fleet-capacity.md';
const VERIFIER = 'GitHub Actions main CI #1292 (run 35523573773)';
const TIMESTAMP = '2026-09-20T16:43:53Z';
const IDS = ['FLEET-010', 'FLEET-011'];
const EVIDENCE = [
  ['FLEET725-CODE', 'CODE'],
  ['FLEET725-UNIT', 'UNIT'],
  ['FLEET725-INTEGRATION', 'INTEGRATION'],
];

const matrixPath = 'docs/jarvis-requirements.json';
const specPath = 'docs/JARVIS_PRODUCT_SPEC.md';
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const byId = new Map(matrix.requirements.map(row => [row.id, row]));
for (const id of IDS) {
  const row = byId.get(id);
  if (!row) throw new Error(`missing ${id}`);
  if (row.required_evidence.join(',') !== 'CODE,UNIT,INTEGRATION') throw new Error(`${id}: evidence contract changed`);
  row.evidence_refs = EVIDENCE.map(([evidenceId]) => evidenceId);
  row.status = 'VERIFIED';
  row.blocker = null;
  row.next_action = 'Maintain the 100-node boundary and fail-closed overflow regression coverage; reopen if fleet capacity behavior changes.';
  row.last_verified_commit = VERIFIED_COMMIT;
}

matrix.evidence_records = matrix.evidence_records.filter(record => !record.id.startsWith('FLEET725-'));
for (const [id, kind] of EVIDENCE) {
  matrix.evidence_records.push({
    id,
    requirement_ids: IDS,
    class: kind,
    result: 'PASS',
    commit: VERIFIED_COMMIT,
    source: EVIDENCE_SOURCE,
    verifier: VERIFIER,
    timestamp: TIMESTAMP,
  });
}
fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);

let spec = fs.readFileSync(specPath, 'utf8');
for (const id of IDS) {
  const row = byId.get(id);
  const replacement = `### ${id}\n\n\`\`\`json\n${JSON.stringify(row, null, 2)}\n\`\`\``;
  const pattern = new RegExp('### ' + id + '\\r?\\n\\r?\\n```json\\r?\\n[\\s\\S]*?\\r?\\n```', 'm');
  if (!pattern.test(spec)) throw new Error(`canonical block missing for ${id}`);
  spec = spec.replace(pattern, replacement);
}
fs.writeFileSync(specPath, spec);

fs.mkdirSync('docs/evidence', { recursive: true });
fs.writeFileSync(EVIDENCE_SOURCE, `# Issue #725 fleet-capacity evidence\n\n## Scope\n\nThis evidence certifies only the software-only requirements FLEET-010 and FLEET-011. It does not certify FLEET-009 or any PHYSICAL-gated fleet requirement.\n\n## Audited baseline\n\n- Main commit: \`${VERIFIED_COMMIT}\`\n- CI: ${VERIFIER}\n- CI conclusion: PASS\n- CI completed: ${TIMESTAMP}\n\n## CODE\n\n\`JarvisFleetManager.register\` rejects a new identity once the fleet already contains \`JARVIS_MAX_NODES\` nodes, and \`restore\` rejects snapshots above the same boundary.\n\n## UNIT / INTEGRATION\n\n\`tests/jarvis-v1-foundation.test.ts\` registers exactly \`JARVIS_MAX_NODES\` nodes, asserts the resulting fleet size is 100, then asserts \`android-101\` is rejected with \`fleet limit exceeded\`. The exact audited main commit passed the repository CI suite in run 35523573773.\n\n## Boundary\n\nNo PHYSICAL evidence is claimed. No enrollment, credential, permission, firewall, billing, deployment, Human Gate, signing, private-ingress, or device-app behavior is changed by this reconciliation.\n`);
