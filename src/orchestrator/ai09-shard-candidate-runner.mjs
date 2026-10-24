import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { reviewLocalPatch } from './ai09-local-reviewer.mjs';
import { verifyFullCoverageReceipts } from './ai09-full-coverage.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const blocked = reason => ({
  status:'BLOCKED', reason, evidenceClass:'AI_ASSERTED',
  githubApprovalSatisfied:false, mergeAuthorized:false,
});

/**
 * Candidate-only model handoff. The caller must separately prove that plan
 * content came from the pinned Git trees. It NEVER posts a review, changes CI
 * policy, merges, starts a service, or treats a model as a GitHub approver.
 * One <=4KiB source slice is passed to the existing AI09 review contract at a
 * time, preventing accidental truncation when shards contain many slices.
 */
export async function runCandidateShardReview({ plan, infer, reviewerId='AI09-candidate',
  maxSlices=4096, modelName='UNVERIFIED', modelRevision='UNVERIFIED',
  onInferenceEvidence=null }={}) {
  const manifest=plan?.manifest, payloads=plan?.payloads;
  if (!manifest || !(payloads instanceof Map) || typeof infer!=='function' ||
      typeof reviewerId!=='string' || !/^[A-Za-z0-9_.:-]{2,80}$/u.test(reviewerId) ||
      !Number.isSafeInteger(maxSlices) || maxSlices<1 || maxSlices>4096 ||
      !/^[A-Za-z0-9_.:/-]{1,96}$/u.test(modelName) ||
      !/^[A-Za-z0-9_.:/-]{1,96}$/u.test(modelRevision) ||
      (onInferenceEvidence!==null && typeof onInferenceEvidence!=='function') ||
      !Array.isArray(manifest.files) || !Array.isArray(manifest.shards) ||
      manifest.files.length<1 || manifest.files.length>500)
    return blocked('AI09_CANDIDATE_INPUT_INVALID');
  const expectedRoot=hash(JSON.stringify({...manifest,manifestSha256:null}));
  if (expectedRoot!==manifest.manifestSha256) return blocked('AI09_MANIFEST_UNTRUSTED');
  const all=new Map();
  let total=0;
  for (const file of manifest.files) {
    if (!file || typeof file.path!=='string' || !Array.isArray(file.slices)) return blocked('AI09_SLICE_RECORD_INVALID');
    for (const s of file.slices) {
      if (s.path!==file.path || !Number.isSafeInteger(s.id) || s.id<1 ||
          !Number.isSafeInteger(s.start) || !Number.isSafeInteger(s.end) ||
          s.start<0 || s.end<=s.start || s.end-s.start>4096 || all.has(s.id))
        return blocked('AI09_SLICE_RECORD_INVALID');
      const value=payloads.get(s.id);
      if (typeof value!=='string' || Buffer.byteLength(value,'utf8')!==s.end-s.start ||
          hash(Buffer.from(value,'utf8'))!==s.sha256)
        return blocked('AI09_SLICE_PAYLOAD_MISMATCH');
      all.set(s.id,{ ...s,side:s.side, text:value });
      total+=s.end-s.start;
    }
  }
  if (!all.size || all.size>maxSlices || payloads.size!==all.size || total!==manifest.totalBytes)
    return blocked('AI09_SLICE_COVERAGE_INCOMPLETE');
  const scheduled=new Set();
  for (const shard of manifest.shards) {
    if (!Array.isArray(shard.sliceIds) || shard.sliceIds.length<1 ||
        shard.sliceIds.length>24 || shard.bytes>120*1024 || shard.fileCount>30 ||
        shard.sliceIds.some(id=>!all.has(id)||scheduled.has(id)))
      return blocked('AI09_SHARD_COVERAGE_INVALID');
    shard.sliceIds.forEach(id=>scheduled.add(id));
  }
  if (scheduled.size!==all.size) return blocked('AI09_SHARD_COVERAGE_INCOMPLETE');
  const receipts=[], actionableFindings=[], inferenceRecords=[];
  let evaluated=0;
  for (const shard of manifest.shards) {
    const results=[];
    let decision='NO_ACTIONABLE_FINDINGS';
    for (const id of shard.sliceIds) {
      const s=all.get(id);
      const source='PINNED_FILE_SLICE id='+id+' side='+s.side+
        ' byteRange='+s.start+':'+s.end+' sha256='+s.sha256+
        '\nBEGIN_UNTRUSTED_FILE_CONTENT\n'+s.text+'\nEND_UNTRUSTED_FILE_CONTENT';
      // The caller-supplied infer callback is NOT an authenticated model.
      // Record only digests and declared provenance, never prompts/responses.
      const observedInfer=async prompt=>{
        const startedAt=new Date().toISOString();
        const requestSha256=hash(Buffer.from(prompt,'utf8'));
        const response=await infer(prompt);
        if(typeof response!=='string' || Buffer.byteLength(response,'utf8')>20000)
          throw Error('AI09_MODEL_RESPONSE_INVALID');
        const record={sliceId:id,path:s.path,side:s.side,sourceSha256:s.sha256,
          requestSha256,responseSha256:hash(Buffer.from(response,'utf8')),
          responseBytes:Buffer.byteLength(response,'utf8'),startedAt,
          finishedAt:new Date().toISOString(),modelName,modelRevision};
        inferenceRecords.push(record);
        if(onInferenceEvidence) await onInferenceEvidence({...record});
        return response;
      };
      const review=await reviewLocalPatch({
        baseSha:manifest.baseSha,headSha:manifest.headSha,
        makerRole:'Builder',paths:[s.path],patch:source,infer:observedInfer,
      });
      evaluated++;
      if (review.status==='BLOCKED') return {
        ...blocked('AI09_MODEL_SLICE_BLOCKED'), evaluatedSlices:evaluated,
        blockedSlice:id, reviewedShards:receipts.length,
      };
      if (review.status==='INCONCLUSIVE') decision='INCONCLUSIVE';
      else if (review.status==='CHANGES_REQUESTED' && decision!=='INCONCLUSIVE')
        decision='CHANGES_REQUESTED';
      const reviewSha256=hash(JSON.stringify(review));
      results.push({sliceId:id,reviewSha256,status:review.status,
        findingCount:review.findings.length,
        inferenceRecordSha256:hash(JSON.stringify(inferenceRecords.at(-1)))});
      // Keep bounded, source-bound findings for independent triage and
      // reproduction. These stay in private candidate results, not PR logs.
      if (review.status==='CHANGES_REQUESTED') {
        for (const finding of review.findings) {
          if (actionableFindings.length>=100 ||
              [finding.summary,finding.evidence,finding.proposedFix].some(value =>
                /(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:authorization|api[_ -]?key|secret|password|access[_ -]?token)\s*[:=]\s*[^\s,;]{8,})/iu.test(value))) {
            return blocked('AI09_SENSITIVE_OR_EXCESS_FINDINGS');
          }
          actionableFindings.push({...finding,sliceId:id,reviewSha256});
        }
      }
    }
    receipts.push({shardId:shard.id,shardDigest:shard.digest,
      manifestSha256:manifest.manifestSha256,baseSha:manifest.baseSha,
      headSha:manifest.headSha,reviewerId,status:decision,
      evidenceSha256:hash(JSON.stringify(results)),
      evaluatedSliceIds:results.map(r=>r.sliceId),sliceResults:results});
  }
  const verified=verifyFullCoverageReceipts(manifest,receipts);
  if (verified.status==='BLOCKED') return blocked('AI09_RECEIPT_VERIFICATION_FAILED');
  if(inferenceRecords.length!==evaluated ||
      inferenceRecords.some((r,i)=>r.sliceId!==Array.from(all.keys())[i]))
    return blocked('AI09_INFERENCE_RECORD_INCOMPLETE');
  return { ...verified, evaluatedSlices:evaluated, receipts, actionableFindings,
    inferenceAudit:{count:inferenceRecords.length,
      ledgerSha256:hash(JSON.stringify(inferenceRecords)),
      records:inferenceRecords, declaredProvenanceOnly:true,
      independentModelVerified:false, durableStorageVerified:false},
    independentReviewerAuthenticated:false, formalGitHubReview:false,
    deploymentAccepted:false };
}
