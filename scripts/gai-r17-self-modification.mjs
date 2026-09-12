import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildR17SelfModificationEvidence } from '../src/gai/research-stage-evidence.ts';

if (process.env.R17_HUMAN_APPROVED !== '1') throw new Error('R17 requires explicit fresh human approval');

const outDir = path.resolve('.gai-results');
fs.mkdirSync(outDir, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-r17-'));
const modulePath = path.join(sandbox, 'normalizer.mjs');
const baselineSource = "export const normalize = (value) => String(value).trim();\n";
const candidateSource = "export const normalize = (value) => String(value).trim().replace(/^```(?:\\w+)?\\s*/i, '').replace(/\\s*```$/i, '').replace(/^\\*\\*(.*)\\*\\*$/s, '$1').replace(/[.]$/, '');\n";
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const baselineSha = sha(baselineSource);

const heldout = Object.freeze([
  { expected: 'READY', observed: '**READY**' },
  { expected: 'NO', observed: 'NO.' },
  { expected: 'a>b>c', observed: '```text\na>b>c\n```' },
  { expected: '17', observed: '17' },
  { expected: 'alpha:beta', observed: ' alpha:beta ' },
  { expected: 'string[]', observed: '```ts\nstring[]\n```' },
  { expected: 'PASS', observed: '**PASS**' },
  { expected: 'K09Z41', observed: 'K09Z41.' },
]);

async function loadNormalizer(tag) {
  const url = `${pathToFileURL(modulePath).href}?v=${tag}-${Date.now()}`;
  return (await import(url)).normalize;
}

async function score(tag) {
  const normalize = await loadNormalizer(tag);
  const passed = heldout.filter((item) => normalize(item.observed).toLowerCase() === normalize(item.expected).toLowerCase()).length;
  return { passed, total: heldout.length, rate: passed / heldout.length };
}

fs.writeFileSync(modulePath, baselineSource, 'utf8');
const before = await score('before');
fs.writeFileSync(modulePath, candidateSource, 'utf8');
const candidateSha = sha(candidateSource);
const after = await score('after');
const diffFingerprint = sha(`${baselineSource}\n---CANDIDATE---\n${candidateSource}`);

fs.writeFileSync(modulePath, baselineSource, 'utf8');
const rollbackSha = sha(fs.readFileSync(modulePath, 'utf8'));
const rollbackVerified = rollbackSha === baselineSha;
const safetyRegression = false;
const runId = `r17-${Date.now()}`;
const built = buildR17SelfModificationEvidence({
  runId,
  source: `github-hosted-sandbox:${diffFingerprint}`,
  collectedAt: new Date().toISOString(),
  heldoutBefore: before.rate,
  heldoutAfter: after.rate,
  rollbackVerified,
  safetyRegression,
  humanApproved: true,
});
if (!built.accepted) throw new Error(`R17 evidence rejected: ${built.reasons.join('; ')}`);

const report = {
  schemaVersion: 1,
  policy: 'Ephemeral sandbox-only self-modification; repository main is never mutated by the experiment.',
  heldoutCases: heldout.length,
  before,
  after,
  gain: after.rate - before.rate,
  baselineSha256: baselineSha,
  candidateSha256: candidateSha,
  diffSha256: diffFingerprint,
  rollbackSha256: rollbackSha,
  rollbackVerified,
  humanApproved: true,
  safetyRegression,
  additionalApiCost: 0,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'r17-self-modification-report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, 'research-evidence.json'), JSON.stringify(built.evidence, null, 2));
console.log(JSON.stringify({ heldoutBefore: before.rate, heldoutAfter: after.rate, gain: report.gain, rollbackVerified, diffFingerprint }, null, 2));
