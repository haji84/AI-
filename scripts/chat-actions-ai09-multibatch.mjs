import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

// A lossless orchestration layer for the EXISTING AI09 limits. Neither
// 24 chunks per reviewer invocation nor 4096 bytes per model input changes.
const SHA = /^[a-f0-9]{40}$/;
const MAX_FILES = 30;
const MAX_BATCH_CHUNKS = 24;
const PREFERRED_BATCH_CHUNKS = 10;
const MAX_CHUNK_BYTES = 4096;
const DIGEST = text => createHash("sha256").update(text).digest("hex");

const narrowCompare = (compare, files) => ({ ...compare, files });

// Keep the trusted 4 KiB native limit intact, then split only the already
// source-verified native chunks into smaller complete model inputs. The
// source/patch bytes and final canonical hash MUST be unchanged.
const TARGET_MODEL_CHUNK_BYTES = 2300;
export function subdivideVerifiedAi09Chunks(native, targetBytes=TARGET_MODEL_CHUNK_BYTES) {
  if (!native || !Array.isArray(native.chunks) || !native.chunks.length ||
      !Array.isArray(native.paths) || !Number.isSafeInteger(targetBytes) ||
      targetBytes<512 || targetBytes>MAX_CHUNK_BYTES)
    throw Error("INVALID_AI09_SUBDIVISION_SCOPE");
  const smaller=[], lastHunk=new Map();
  for(const original of native.chunks){
    if (!Array.isArray(original.paths) || original.paths.length!==1 ||
        !Number.isSafeInteger(original.fileIndex) ||
        original.fileIndex<0 || original.fileIndex>=native.paths.length ||
        original.paths[0]!==native.paths[original.fileIndex] ||
        typeof original.source!=="string" || !original.source ||
        typeof original.patch!=="string" ||
        Buffer.byteLength(original.patch,"utf8")>MAX_CHUNK_BYTES)
      throw Error("INVALID_NATIVE_AI09_SOURCE_CHUNK");
    const path=original.paths[0], header="diff --git a/"+path+" b/"+path;
    const rows=original.source.split("\n");
    const sections=[];
    let current=[], hunk=lastHunk.get(path)??null, startingHunk=hunk;
    function display(part, context) {
      if(!part.length)throw Error("EMPTY_AI09_REVIEW_SECTION");
      if(!part[0].startsWith("@@") && !context)
        throw Error("MISSING_AI09_HUNK_CONTEXT");
      return header+"\n# AI09_READONLY_SUBSLICE (all original source lines retained)\n"+
        (part[0].startsWith("@@")?"":context+"\n")+part.join("\n");
    }
    function flush(){
      if(!current.length)return;
      const patch=display(current,startingHunk);
      if(Buffer.byteLength(patch,"utf8")>targetBytes)
        throw Error("UNREVIEWABLE_AI09_SOURCE_LINE");
      sections.push({fileIndex:original.fileIndex,paths:[path],
        source:current.join("\n"),patch});
      current=[];
      startingHunk=hunk;
    }
    for(const row of rows){
      let next=[...current,row];
      // Do not split a line. If one source row is oversized, fail closed.
      if(Buffer.byteLength(display(next,startingHunk),"utf8")>targetBytes) {
        flush();
        next=[row];
        if(Buffer.byteLength(display(next,startingHunk),"utf8")>targetBytes)
          throw Error("UNREVIEWABLE_AI09_SOURCE_LINE");
      }
      current=next;
      if(row.startsWith("@@")){
        if(!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(row))
          throw Error("UNSUPPORTED_AI09_HUNK_HEADER");
        hunk=row;
      }
    }
    flush();
    lastHunk.set(path,hunk);
    if(sections.map(c=>c.source).join("\n")!==original.source)
      throw Error("AI09_SOURCE_SUBSLICE_LOSS");
    smaller.push(...sections);
  }
  if(smaller.length<1 ||
     smaller.some(x=>Buffer.byteLength(x.patch,"utf8")>targetBytes) ||
     smaller.some(x=>Buffer.byteLength(x.patch,"utf8")>MAX_CHUNK_BYTES))
    throw Error("AI09_SUBDIVISION_LIMIT_EXCEEDED");
  for(let i=0;i<native.paths.length;i++){
    const oldFile=native.chunks.filter(c=>c.fileIndex===i)
      .map(c=>c.source).join("\n");
    const newFile=smaller.filter(c=>c.fileIndex===i)
      .map(c=>c.source).join("\n");
    if(oldFile!==newFile)throw Error("AI09_CANONICAL_FILE_COVERAGE_MISMATCH");
    const path=native.paths[i];
    if(!native.patch.includes("diff --git a/"+path+" b/"+path+"\n"+newFile))
      throw Error("AI09_SOURCE_PATCH_MISMATCH");
  }
  // Each review receipt still refers to its own precise, independently
  // hashed sub-patch; no part can silently pass as the original whole chunk.
  return {...native,chunks:smaller};
}


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
    const verified=modules.batches.compareToReviewChunks(
      narrowCompare(compare, files), baseSha, headSha);
    const smaller=subdivideVerifiedAi09Chunks(verified);
    if(smaller.chunks.length>MAX_BATCH_CHUNKS)
      throw Error("review_chunk_budget_exhausted");
    return smaller;
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
      // Prefer small independent CPU review jobs; 24 is still the hard limit.
      if(pending.length && next.chunks.length > PREFERRED_BATCH_CHUNKS){
        commit();
        pending=[file];
        candidate=prepare(pending);
      }else{
        pending=attempt;
        candidate=next;
      }
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
