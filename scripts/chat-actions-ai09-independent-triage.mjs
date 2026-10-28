// Independent evidence triage for AI09 model findings.
// Quoted code is evidence of location, NOT evidence of actual impact or exploitability.
import { createHash } from "node:crypto";
import { auditAi09ClaimSupport } from "./chat-actions-ai09-batch-runner.mjs";

const SHA = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const digest = s => createHash("sha256").update(s).digest("hex");

/**
 * Recompute every model-claim anchor from the canonical complete batch patch,
 * never from its author-supplied diagnostic. No model can self-confirm impact.
 * Raw receipts and AI09 status remain authoritative until an independent,
 * reproducible verifier demonstrates concrete behavior on the same revision.
 */
export function independentlyAuditAi09Claims({plan,receipts,anchorModule}) {
  if (!plan || !SHA.test(plan.headSha ?? "") ||
      !SHA.test(plan.baseSha ?? "") || !HEX64.test(plan.patchSha256 ?? "") ||
      !Array.isArray(plan.batches) || plan.batches.length !== plan.batchCount ||
      !Array.isArray(receipts) || receipts.length > 30 ||
      typeof anchorModule?.anchorAudit !== "function")
    throw Error("INVALID_INDEPENDENT_TRIAGE_SCOPE");
  const claims = [];
  const inspectedBatches = new Set();
  let invalidReceipts = 0;
  for (const receipt of receipts) {
    const batch = plan.batches[receipt?.index];
    if (!batch || inspectedBatches.has(receipt.index) ||
        receipt.headSha !== plan.headSha ||
        receipt.baseSha !== plan.baseSha ||
        receipt.patchSha256 !== batch.patchSha256 ||
        !Array.isArray(receipt.chunkReports) ||
        receipt.chunkReports.length > batch.chunkCount ||
        receipt.githubApprovalSatisfied !== false ||
        receipt.mergeAuthorized !== false) {
      invalidReceipts++;
      continue;
    }
    inspectedBatches.add(receipt.index);
    for (const [index, report] of receipt.chunkReports.entries()) {
      const expectedChunk = batch.chunks[index];
      if (!expectedChunk || report?.scope?.baseSha !== plan.baseSha ||
          report?.scope?.headSha !== plan.headSha ||
          report?.scope?.patchSha256 !== digest(expectedChunk.patch) ||
          report?.reviewer !== "AI-09" || report?.evidenceClass !== "AI_ASSERTED" ||
          report?.githubApprovalSatisfied !== false ||
          report?.mergeAuthorized !== false ||
          report?.independentGitHubAccountVerified !== false || report?.physicalEvidenceVerified !== false ||
          JSON.stringify(report?.scope?.paths) !== JSON.stringify(expectedChunk.paths) ||
          !["NO_ACTIONABLE_FINDINGS","CHANGES_REQUESTED","INCONCLUSIVE","BLOCKED"].includes(report?.status) ||
          !Array.isArray(report?.findings) || report.findings.length > 20 ||
          report.status === "CHANGES_REQUESTED" && report.findings.length === 0 ||
          report.findings.some(f => !expectedChunk.paths.includes(f?.path))) {
        invalidReceipts++;
        continue;
      }
      if (report.status !== "CHANGES_REQUESTED" && report.status !== "INCONCLUSIVE") {
        if (report.findings.length) invalidReceipts++;
        continue;
      }
      const checks = auditAi09ClaimSupport(report.findings,batch.patch,anchorModule);
      for (const [n,f] of report.findings.entries()) {
        if(claims.length >= 200)throw Error("UNBOUNDED_TRIAGE_CLAIMS");
        const support=checks.checks[n];
        const findingHash=digest(JSON.stringify({
          headSha:plan.headSha,batch:receipt.index,chunk:index,
          path:f.path,line:f.line,severity:f.severity,
          summary:f.summary,evidence:f.evidence,proposedFix:f.proposedFix,
        }));
        const anchored=support?.supportedForTriage === true;
        claims.push({
          batch:receipt.index,chunk:index,ordinal:n,reviewStatus:report.status,
          findingSha256:findingHash,
          path:f.path,line:f.line,severity:f.severity,
          codeQuoteAnchored:support?.anchored === true,
          impactClaimExplained:support?.impactExplained === true,
          proposedFixSpecified:support?.remediationSpecified === true,
          status:anchored ? "PENDING_INDEPENDENT_BEHAVIORAL_VERIFICATION" :
            "UNGROUNDED_MODEL_CLAIM",
          // Never assert the effect is real from the model's own summary.
          independentImpactVerified:false,readyForAutomaticRepair:false,
        });
      }
    }
  }
  const missingBatchIndexes = plan.batches
    .filter(b=>!inspectedBatches.has(b.index)).map(b=>b.index);
  return {
    headSha:plan.headSha,baseSha:plan.baseSha,patchSha256:plan.patchSha256,
    expectedBatches:plan.batchCount,inspectedBatches:inspectedBatches.size,
    missingBatchIndexes,invalidReceipts,claims,
    groundedClaims:claims.filter(c=>c.codeQuoteAnchored &&
      c.impactClaimExplained && c.proposedFixSpecified).length,
    pendingIndependentVerification:claims.length,
    independentImpactVerified:0,
    status:invalidReceipts || missingBatchIndexes.length ? "BLOCKED" :
      claims.length ? "REQUIRES_INDEPENDENT_VERIFICATION" : "NO_MODEL_CLAIMS",
    evidenceClass:"MACHINE_VERIFIED_SOURCE_LOCATION_ONLY",
    githubApprovalSatisfied:false,mergeAuthorized:false,
  };
}
