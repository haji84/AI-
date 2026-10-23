import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

// A lossless orchestration layer for the EXISTING AI09 limits. Neither
// 24 chunks per reviewer invocation nor 4096 bytes per model input changes.
const SHA = /^[a-f0-9]{40}$/;
const MAX_FILES = 30;
const MAX_BATCH_CHUNKS = 24;
const MAX_CHUNK_BYTES = 4096;
const DIGEST = text => createHash("sha256").update(text).digest("hex");

const narrowCompare = (compare, files) => ({ ...compare, files });

/**
 * Partition by complete files only. Each partition must pass the actual
 * trusted AI09 chunker independently; concatenated partitions MUST equal the
 * canonical complete comparison, byte for byte. Never truncate or skip.
 */
export function planCompleteAi09Review(compare, baseSha, headSha, modules) {
  if (!SHA.test(baseSha) || !SHA.test(headSha) || baseSha === headSha ||
      !Array.isArray(compare?.files) || compare.files.length < 1 ||
      compare.files.length > MAX_FILES ||
      typeof modules?.coverage?.assertCompleteComparison !== "function" ||
      typeof modules?.batches?.compareToPatch !== "function" ||
      typeof modules?.batches?.compareToReviewChunks !== "function")
    throw Error("INVALID_FULL_REVIEW_SCOPE");
  modules.coverage.assertCompleteComparison(compare);
  // The native 120 KiB limit still applies to EACH independently reviewed
  // batch. Larger full PRs are composed only from natively validated, complete
  // per-file patches; the aggregate itself has a separate finite 256 KiB cap.
  const fileProofs = compare.files.map(file =>
    modules.batches.compareToPatch(narrowCompare(compare,[file]),baseSha,headSha));
  const combinedCanonical = fileProofs.map(p=>p.patch).join("\n");
  if (Buffer.byteLength(combinedCanonical,"utf8") > 256*1024)
    throw Error("REVIEW_AGGREGATE_BUDGET_EXHAUSTED");
  const canonical = {
    paths: fileProofs.flatMap(p=>p.paths),
    patch: combinedCanonical,
    patchSha256:DIGEST(combinedCanonical),
  };
  const batches = [];
  let pending = [];
  let candidate = null;
  function prepare(files) {
    return modules.batches.compareToReviewChunks(
      narrowCompare(compare, files), baseSha, headSha);
  }
  function commit() {
    if (!pending.length || !candidate) throw Error("EMPTY_REVIEW_BATCH");
    const index = batches.length;
    if (candidate.chunks.length < 1 || candidate.chunks.length > MAX_BATCH_CHUNKS ||
        candidate.chunks.some(c => Buffer.byteLength(c.patch,"utf8") > MAX_CHUNK_BYTES))
      throw Error("REVIEW_BATCH_LIMIT_EXCEEDED");
    batches.push({
      index, paths: candidate.paths,
      patchSha256: candidate.patchSha256,
      patch: candidate.patch, chunks: candidate.chunks,
      chunkCount: candidate.chunks.length,
    });
    pending = [];
    candidate = null;
  }
  for (const file of compare.files) {
    const attempt = [...pending, file];
    try {
      const next = prepare(attempt);
      pending = attempt;
      candidate = next;
    } catch (cause) {
      // Only the existing per-run chunk-count limit can cause a new batch.
      // All other errors, including missing hunks and oversized lines, HOLD.
      if (cause?.message !== "review_chunk_budget_exhausted" || !pending.length)
        throw cause;
      commit();
      pending = [file];
      candidate = prepare(pending);
    }
  }
  commit();
  const combined = batches.map(b => b.patch).join("\n");
  const paths = batches.flatMap(b => b.paths);
  if (combined !== canonical.patch ||
      DIGEST(combined) !== canonical.patchSha256 ||
      JSON.stringify(paths) !== JSON.stringify(canonical.paths) ||
      new Set(paths).size !== paths.length ||
      batches.some(b => b.chunkCount !== b.chunks.length ||
        b.patchSha256 !== DIGEST(b.patch)))
    throw Error("INCOMPLETE_OR_DUPLICATED_REVIEW_COVERAGE");
  return {
    baseSha, headSha, patchSha256:canonical.patchSha256,
    paths, batchCount:batches.length,
    totalChunks:batches.reduce((n,b) => n+b.chunkCount, 0),
    batches,
    // This object is a plan, not an AI09 finding or an approval.
    evidenceClass:"MACHINE_VERIFIED_PLAN",
    mergeAuthorized:false, githubApprovalSatisfied:false,
  };
}

/** Preserve valid early findings even if later chunks are unavailable. */
export function collectAi09Evidence(plan, batchReports, modules) {
  if (plan?.evidenceClass !== "MACHINE_VERIFIED_PLAN" ||
      !SHA.test(plan.baseSha ?? "") || !SHA.test(plan.headSha ?? "") ||
      !Array.isArray(plan.batches) || plan.batches.length !== plan.batchCount ||
      !Array.isArray(batchReports) ||
      typeof modules?.batches?.consolidateChunkReviews !== "function" ||
      typeof modules?.anchor?.holdUngroundedAdvisory !== "function")
    throw Error("INVALID_BATCH_EVIDENCE");
  const observations = [];
  const unresolved = [];
  let sawBlocker = batchReports.length !== plan.batchCount;
  let sawInconclusive = false;
  let sawFindings = false;
  for (const batch of plan.batches) {
    const envelope = batchReports.find(r => r?.index === batch.index);
    const matching = batchReports.filter(r => r?.index === batch.index);
    if (matching.length !== 1 || envelope?.patchSha256 !== batch.patchSha256 ||
        !Array.isArray(envelope?.chunkReports)) {
      sawBlocker = true;
      observations.push({ index:batch.index, status:"BLOCKED",reason:"MISSING_OR_STALE_BATCH" });
      continue;
    }
    const reports = envelope.chunkReports;
    // A truncated batch remains blocked; do not erase earlier actionable claims.
    for (const report of reports) {
      if (report?.reviewer !== "AI-09" || report?.evidenceClass !== "AI_ASSERTED" ||
          report?.githubApprovalSatisfied !== false || report?.mergeAuthorized !== false ||
          !Array.isArray(report?.findings) ||
          report.findings.some(f => !batch.paths.includes(f.path))) {
        sawBlocker = true;
        continue;
      }
      if (report.status === "CHANGES_REQUESTED") {
        sawFindings = true;
        unresolved.push(...report.findings.map(f => ({
          batch:batch.index, ...f, evidenceClass:"AI_ASSERTED_UNVERIFIED",
        })));
      }
    }
    const scope = {
      baseSha:plan.baseSha, headSha:plan.headSha,
      paths:batch.paths, patchSha256:batch.patchSha256,
      reviewChunks:batch.chunkCount,
    };
    // Existing native verifier enforces exact per-chunk patch hashes and count.
    // A missing/invalid chunk cannot become NO_ACTIONABLE_FINDINGS.
    const result = modules.batches.consolidateChunkReviews(
      reports, scope, batch.chunks);
    const grounded = modules.anchor.holdUngroundedAdvisory(result,batch.patch);
    if (grounded.status === "BLOCKED") sawBlocker = true;
    if (grounded.status === "INCONCLUSIVE") sawInconclusive = true;
    if (grounded.status === "CHANGES_REQUESTED") {
      sawFindings = true;
    }
    observations.push({
      index:batch.index, status:grounded.status, blockers:grounded.blockers,
      chunkReceipts:reports.length, expectedChunks:batch.chunkCount,
      patchSha256:batch.patchSha256,
    });
  }
  if (new Set(batchReports.map(r => r?.index)).size !== batchReports.length)
    sawBlocker = true;
  const status = sawBlocker ? "BLOCKED" : sawInconclusive ? "INCONCLUSIVE" :
    sawFindings ? "CHANGES_REQUESTED" : "NO_ACTIONABLE_FINDINGS";
  return {
    status, baseSha:plan.baseSha, headSha:plan.headSha,
    patchSha256:plan.patchSha256,
    requiredBatches:plan.batchCount,
    receivedBatches:batchReports.length,
    totalChunks:plan.totalChunks,
    observations, unresolvedFindings:unresolved,
    evidenceClass:"AI_ASSERTED",
    githubApprovalSatisfied:false, mergeAuthorized:false,
  };
}

export function assertNoWriteAuthority(summary) {
  if (summary?.mergeAuthorized !== false ||
      summary?.githubApprovalSatisfied !== false)
    throw Error("AI09_MUST_NOT_GRANT_AUTHORITY");
  return true;
}
