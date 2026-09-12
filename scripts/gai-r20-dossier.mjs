import fs from 'node:fs';
import path from 'node:path';
import { buildResearchDossier } from '../src/gai/research-dossier.ts';

const ledgerPath = process.argv.find((arg) => arg.startsWith('--ledger='))?.slice('--ledger='.length) || process.env.GAI_RESEARCH_LEDGER;
if (!ledgerPath) throw new Error('R20 dossier requires --ledger=<path> or GAI_RESEARCH_LEDGER');
const outDir = path.resolve('.gai-results');
fs.mkdirSync(outDir, { recursive: true });
const raw = JSON.parse(fs.readFileSync(path.resolve(ledgerPath), 'utf8'));
const evidence = Array.isArray(raw) ? raw : raw.evidence;
if (!Array.isArray(evidence)) throw new Error('research evidence ledger payload is invalid');

const unresolvedSafetyRegression = evidence.some((item) => item.kind === 'safety-regression' && item.verified && item.metrics?.regression === true);
const additionalPaygApiCost = evidence.reduce((sum, item) => {
  const value = Number(item.metrics?.additionalApiCost ?? 0);
  return Number.isFinite(value) ? sum + value : sum;
}, 0);
const hasIndependentReplication = evidence.some((item) => item.stage === 'R19' && item.kind === 'independent-replication' && item.verified);
const hasExternalBenchmark = evidence.some((item) => ['R3','R12','R19'].includes(item.stage) && item.kind === 'external-benchmark' && item.verified);
const independentExternalValidation = hasIndependentReplication && hasExternalBenchmark;

const contradictions = [];
if (!hasExternalBenchmark) contradictions.push({ id: 'missing-external-benchmark', description: 'No verified external benchmark evidence is present.', severity: 'high', resolved: false });
if (!hasIndependentReplication) contradictions.push({ id: 'missing-independent-replication', description: 'No verified independent replication evidence is present.', severity: 'high', resolved: false });
if (additionalPaygApiCost !== 0) contradictions.push({ id: 'nonzero-payg-cost', description: 'Zero-additional-pay-as-you-go-cost policy was violated.', severity: 'high', resolved: false });

const dossier = buildResearchDossier({
  evidence,
  contradictions,
  independentExternalValidation,
  unresolvedSafetyRegression,
  additionalPaygApiCost,
});
const summary = {
  generatedAt: dossier.generatedAt,
  verifiedEvidenceCount: dossier.verifiedEvidenceCount,
  completedStages: dossier.assessments.filter((item) => item.status === 'complete').map((item) => item.stage),
  readyStages: dossier.assessments.filter((item) => item.status === 'ready').map((item) => item.stage),
  blockedStages: dossier.assessments.filter((item) => item.status === 'blocked').map((item) => item.stage),
  unresolvedContradictions: dossier.unresolvedContradictions,
  independentExternalValidation,
  agiClaimAllowed: dossier.agiClaim.allowed,
  agiClaimReasons: dossier.agiClaim.reasons,
};
fs.writeFileSync(path.join(outDir, 'r20-research-dossier.json'), JSON.stringify(dossier, null, 2));
fs.writeFileSync(path.join(outDir, 'r20-dossier-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (dossier.agiClaim.allowed && !independentExternalValidation) throw new Error('fail-closed: AGI claim cannot be allowed without independent external validation');
