import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matrixPath = path.join(root, 'docs', 'jarvis-requirements.json');
const specPath = path.join(root, 'docs', 'JARVIS_PRODUCT_SPEC.md');

const verifiedCommit = '4040e22a61b1069213de5ee159a80cdf7846dc7e';
const verifiedAt = '2026-09-20T13:12:50Z';
const targetIds = new Set(['NET-005', 'NET-006', 'NET-007']);
const evidenceIds = [
  'NETSEC-885-CODE',
  'NETSEC-885-UNIT',
  'NETSEC-885-INTEGRATION',
  'NETSEC-885-SECURITY',
];

const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const rows = new Map(matrix.requirements.map(row => [row.id, row]));
for (const id of targetIds) {
  const row = rows.get(id);
  if (!row) throw new Error(`Missing canonical requirement ${id}`);
  row.evidence_refs = [...evidenceIds];
  row.status = 'VERIFIED';
  row.blocker = null;
  row.platform_limit = null;
  row.fallback = null;
  row.next_action = 'Maintain regression coverage; reopen if owner authentication, worker signing, nonce/replay, or clock protection regresses.';
  row.last_verified_commit = verifiedCommit;
}

const evidenceSource = 'docs/evidence/885-net-security-invariants.md';
const verifier = 'GitHub Actions main CI #1275 (run 35512801434)';
const evidenceRecords = [
  ['NETSEC-885-CODE', 'CODE'],
  ['NETSEC-885-UNIT', 'UNIT'],
  ['NETSEC-885-INTEGRATION', 'INTEGRATION'],
  ['NETSEC-885-SECURITY', 'SECURITY'],
].map(([id, evidenceClass]) => ({
  id,
  requirement_ids: [...targetIds],
  class: evidenceClass,
  result: 'PASS',
  commit: verifiedCommit,
  source: evidenceSource,
  verifier,
  timestamp: verifiedAt,
}));

const unrelatedRecords = (matrix.evidence_records ?? []).filter(record => !evidenceIds.includes(record.id));
matrix.evidence_records = [...unrelatedRecords, ...evidenceRecords];

let spec = fs.readFileSync(specPath, 'utf8');
const seen = new Map([...targetIds].map(id => [id, 0]));
spec = spec.replace(/```json\r?\n([\s\S]*?)\r?\n```/g, (whole, jsonText) => {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return whole;
  }
  if (!targetIds.has(parsed?.id)) return whole;
  seen.set(parsed.id, (seen.get(parsed.id) ?? 0) + 1);
  return `\`\`\`json\n${JSON.stringify(rows.get(parsed.id), null, 2)}\n\`\`\``;
});

for (const [id, count] of seen) {
  if (count !== 1) throw new Error(`${id}: expected exactly one product-spec JSON block, found ${count}`);
}

fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
fs.writeFileSync(specPath, spec, 'utf8');

console.log(JSON.stringify({
  status: 'UPDATED',
  requirements: [...targetIds],
  evidence: evidenceIds,
  verified_commit: verifiedCommit,
}, null, 2));
