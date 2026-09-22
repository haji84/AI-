import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIREMENT_ID = 'UI-007';
export const BASELINE_MAIN = 'f974cc39dc25697e6cf999764e9d695ee753e14d';
export const EVIDENCE_SOURCE = 'docs/evidence/1191-ui007-presets.md';
export const IMPLEMENTATION_REFS = Object.freeze([
  'src/app/jarvis/ui-preferences.ts',
  'src/app/jarvis/settings/JarvisLocalSettings.tsx',
  'src/app/jarvis/themes.css',
]);
export const TEST_REFS = Object.freeze([
  'tests/jarvis-p5-customization-presets.test.mjs',
]);
const REQUIRED_EVIDENCE = Object.freeze(['CODE', 'UNIT', 'INTEGRATION', 'PHYSICAL']);

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

export function reconcileUi007(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const matrixPath = path.join(root, options.matrixPath ?? 'docs/jarvis-requirements.json');
  const specPath = path.join(root, options.specPath ?? 'docs/JARVIS_PRODUCT_SPEC.md');
  const evidencePath = path.join(root, options.evidencePath ?? EVIDENCE_SOURCE);

  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const row = matrix.requirements?.find(candidate => candidate?.id === REQUIREMENT_ID);
  if (!row) throw new Error(`missing ${REQUIREMENT_ID}`);
  if (!sameArray(row.required_evidence, REQUIRED_EVIDENCE)) {
    throw new Error(`${REQUIREMENT_ID}: evidence contract changed; refusing reconciliation`);
  }
  if (!fs.existsSync(evidencePath)) throw new Error(`missing evidence source ${EVIDENCE_SOURCE}`);

  for (const ref of [...IMPLEMENTATION_REFS, ...TEST_REFS]) {
    if (!fs.existsSync(path.join(root, ref))) throw new Error(`missing mapped repository reference ${ref}`);
  }

  row.implementation_refs = [...IMPLEMENTATION_REFS];
  row.test_refs = [...TEST_REFS];
  row.evidence_refs = [EVIDENCE_SOURCE];
  row.status = 'PARTIAL';
  row.blocker = 'Software implementation and regression evidence are mapped on current main; required PHYSICAL acceptance remains pending.';
  row.platform_limit = null;
  row.fallback = null;
  row.next_action = 'Retain PARTIAL until UI-007 PHYSICAL acceptance is captured; continue independent non-physical JARVIS gaps without treating CI as physical proof.';
  row.last_verified_commit = null;
  row.delivery_audit = {
    ...(row.delivery_audit ?? {}),
    main_revision: BASELINE_MAIN,
    implementation: 'MAIN_CODE_PRESENT',
    connection: 'RUNTIME_ACCEPTANCE_REQUIRED',
    physical: 'PENDING',
    audit_ref: EVIDENCE_SOURCE,
  };

  fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');

  let spec = fs.readFileSync(specPath, 'utf8');
  const replacement = `### ${REQUIREMENT_ID}\n\n\`\`\`json\n${JSON.stringify(row, null, 2)}\n\`\`\``;
  const pattern = new RegExp(`### ${REQUIREMENT_ID}\\r?\\n\\r?\\n\`\`\`json\\r?\\n[\\s\\S]*?\\r?\\n\`\`\``, 'm');
  if (!pattern.test(spec)) throw new Error(`canonical block missing for ${REQUIREMENT_ID}`);
  spec = spec.replace(pattern, replacement);
  fs.writeFileSync(specPath, spec, 'utf8');

  return row;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const row = reconcileUi007();
  process.stdout.write(`${JSON.stringify({ status: 'PASS', requirement: row.id, productStatus: row.status, physical: row.delivery_audit.physical })}\n`);
}
