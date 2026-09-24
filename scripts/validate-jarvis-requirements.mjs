import {loadAdditionalInventory,validateAdditionalInventory} from "./jarvis-additional-inventory.mjs";
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Frozen owner inventory, independent of the matrix: deleting a row must fail.
export const REQUIRED_COUNTS = Object.freeze({ NET: 7, HOST: 8, FLEET: 11, 'DEV-A': 15, 'DEV-I': 8, 'DEV-PC': 7, RA: 22, UI: 38, INT: 17, GEST: 8, AUTO: 31, MEM: 8, OFF: 12, SEC: 19, OPS: 18, ACC: 9, TEACH: 6, MIG: 30, CORE: 34, GOV: 28, 'DEV-AX': 4, RST: 11 });
const statuses = new Set(['VERIFIED', 'IMPLEMENTED_UNVERIFIED', 'PARTIAL', 'MISSING', 'PLATFORM_LIMITED']);
const classes = new Set(['CODE', 'UNIT', 'INTEGRATION', 'SECURITY', 'PHYSICAL', 'RECOVERY']);
const requiredFields = ['id', 'title', 'description', 'phase', 'required_evidence', 'implementation_refs', 'test_refs', 'evidence_refs', 'status', 'blocker', 'platform_limit', 'fallback', 'next_action', 'last_verified_commit'];
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const physicalRequired = id => /^(NET-00[1-4]|HOST-|DEV-|RA-(?!021)|ACC-|TEACH-|OFF-012|MIG-|CORE-0(?:18|19|21|22)|GOV-0(?:11|12))/.test(id);

export function validateRequirements(matrix, ledger, root, inventory = loadAdditionalInventory(root)) {
  const errors = [];
  if (!matrix || matrix.schema_version !== 1 || !Array.isArray(matrix.requirements) || !Array.isArray(matrix.evidence_records)) return ['Invalid requirement matrix envelope'];
  const expected = Object.entries(REQUIRED_COUNTS).flatMap(([group, count]) => Array.from({ length: count }, (_, i) => `${group}-${String(i + 1).padStart(3, '0')}`));
  errors.push(...validateAdditionalInventory(inventory));
  const allocations=Array.isArray(inventory?.allocations)?inventory.allocations:[];
  expected.push(...allocations.map(a=>a.id));
  const ids = matrix.requirements.map(row => row?.id);
  for (const id of expected) if (ids.filter(item => item === id).length !== 1) errors.push(`${id}: must occur exactly once`);
  for (const id of ids) if (!expected.includes(id)) errors.push(`Unknown requirement ${id}`);
  let canonical;
  try { canonical = [...ledger.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(match => JSON.parse(match[1])); }
  catch { errors.push('Invalid canonical ledger JSON'); }
  if (!isDeepStrictEqual(canonical, matrix.requirements)) errors.push('Canonical ledger and matrix differ');
  const records = matrix.evidence_records;
  for (const record of records) {
    if (!text(record.id) || records.filter(item => item.id === record.id).length !== 1) errors.push('Evidence IDs must be unique nonempty strings');
    if (!classes.has(record.class) || record.result !== 'PASS' || !sha(record.commit) || !text(record.source) || !text(record.verifier) || !text(record.timestamp) || !Number.isFinite(Date.parse(record.timestamp))) errors.push(`Invalid evidence record ${record.id}`);
    if (['PHYSICAL', 'RECOVERY'].includes(record.class) && (!text(record.device) || !text(record.platform) || !text(record.task_id) || record.simulated !== false)) errors.push(`${record.id}: physical/recovery evidence requires real device, platform and task identity`);
  }
  for (const row of matrix.requirements) {
    const fail = message => errors.push(`${row.id}: ${message}`);
    for (const field of requiredFields) if (!(field in row)) fail(`missing ${field}`);
    for (const field of ['title', 'description', 'next_action']) if (!text(row[field])) fail(`empty ${field}`);
    if (!/^P(?:[0-9]|10)$/.test(row.phase)) fail('invalid phase');
    if (!statuses.has(row.status)) fail('invalid status');
    for (const field of ['required_evidence', 'implementation_refs', 'test_refs', 'evidence_refs']) if (!Array.isArray(row[field]) || row[field].some(item => !text(item))) fail(`invalid ${field}`);
    const allocation=allocations.find(a=>a.id===row.id);
    if(allocation&&(!row.source_decisions?.includes(allocation.decision_id)||allocation.required_evidence.some(kind=>!row.required_evidence?.includes(kind))))fail("additional source/evidence floor may not be removed");
    const needs = Array.isArray(row.required_evidence) ? row.required_evidence : [];
    if (!needs.length || needs.some(item => !classes.has(item)) || new Set(needs).size !== needs.length) fail('invalid required evidence classes');
    if (physicalRequired(row.id) && !needs.includes('PHYSICAL')) fail('PHYSICAL evidence may not be removed');
    if (/^SEC-/.test(row.id) && !needs.includes('SECURITY')) fail('SECURITY evidence may not be removed');
    for (const ref of [...(row.implementation_refs ?? []), ...(row.test_refs ?? [])]) {
      const full = path.resolve(root, ref);
      if (path.isAbsolute(ref) || !full.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(full)) fail(`invalid repository reference ${ref}`);
    }
    if (row.last_verified_commit !== null && !sha(row.last_verified_commit)) fail('invalid last_verified_commit');
    if (row.status === 'VERIFIED') {
      if (!sha(row.last_verified_commit) || row.blocker !== null || !row.implementation_refs?.length || !row.test_refs?.length) fail('VERIFIED requires commit, implementation, tests and no blocker');
      for (const kind of needs) if (!records.some(record => row.evidence_refs?.includes(record.id) && record.class === kind && record.result === 'PASS' && record.commit === row.last_verified_commit && record.requirement_ids?.includes(row.id))) fail(`missing ${kind} evidence for verified commit`);
    }
    if (row.status === 'PLATFORM_LIMITED') {
      const limit = row.platform_limit;
      const fallback = row.fallback;
      if (!text(limit?.reason) || !Array.isArray(limit?.sources) || !limit.sources.length || !text(fallback?.description) || !fallback?.implementation_refs?.length || !fallback?.test_refs?.length || !text(fallback?.ui_capability_ref) || !fallback?.evidence_refs?.length) fail('PLATFORM_LIMITED needs sourced platform restriction and implemented/tested/displayed fallback');
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const matrix = JSON.parse(fs.readFileSync(path.join(root, 'docs/jarvis-requirements.json'), 'utf8'));
  const ledger = fs.readFileSync(path.join(root, 'docs/JARVIS_PRODUCT_SPEC.md'), 'utf8');
  const errors = validateRequirements(matrix, ledger, root);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(JSON.stringify({ status: 'PASS', requirements: matrix.requirements.length, statuses: matrix.requirements.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }), {}), product_complete: matrix.requirements.every(row => ['VERIFIED', 'PLATFORM_LIMITED'].includes(row.status)) }));
}
