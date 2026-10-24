import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { planFullCoverage } from '../src/orchestrator/ai09-full-coverage.mjs';
import { runCandidateShardReview } from '../src/orchestrator/ai09-shard-candidate-runner.mjs';

const baseSha='a'.repeat(40),headSha='b'.repeat(40);
const answer=()=>JSON.stringify({verdict:'NO_FINDINGS',findings:[]});
function source(n=207) {
  const files=Array.from({length:n},(_,i)=>({
    path:'code/review-'+i+'.mjs',status:'added',before:null,
    after:Buffer.from('export const item='+i+';\n','utf8'),
  }));
  return planFullCoverage({baseSha,headSha,files,expectedPaths:files.map(x=>x.path)});
}
test('all 207 separate model slice calls are bound into advisory receipts, never a formal approval',async()=>{
  const p=source(); let calls=0;
  const result=await runCandidateShardReview({plan:p,infer:async prompt=>{
    calls++; assert.match(prompt,/BEGIN_UNTRUSTED_PATCH/u);
    return answer();
  }});
  assert.equal(result.status,'NO_ACTIONABLE_FINDINGS');
  assert.equal(result.evaluatedSlices,207);
  assert.equal(calls,207);
  assert.equal(result.reviewedFiles,207);
  assert.equal(result.independentReviewerAuthenticated,false);
  assert.equal(result.githubApprovalSatisfied,false);
  assert.equal(result.mergeAuthorized,false);
  assert.equal(result.formalGitHubReview,false);
  assert.equal(result.receipts.reduce((n,r)=>n+r.evaluatedSliceIds.length,0),207);
  assert.equal(result.receipts.reduce((n,r)=>n+r.sliceResults.length,0),207);
});
test('a changed source byte, dropped payload or missing shard prevents review calls',async()=>{
  const p=source(3);let calls=0;
  const infer=async()=>{calls++;return answer();};
  p.payloads.set(1,'different source');
  assert.equal((await runCandidateShardReview({plan:p,infer})).status,'BLOCKED');
  assert.equal(calls,0);
  const p2=source(3);p2.manifest.shards[0].sliceIds.pop();
  assert.equal((await runCandidateShardReview({plan:p2,infer})).status,'BLOCKED');
  assert.equal(calls,0);
});
test('inference errors, inconclusive results, self-review or fake response never pass',async()=>{
  const p=source(3);
  assert.equal((await runCandidateShardReview({plan:p,infer:async()=>{throw Error('offline');}})).status,'BLOCKED');
  assert.equal((await runCandidateShardReview({plan:p,infer:async()=>JSON.stringify({verdict:'INCONCLUSIVE',findings:[]})})).status,'INCONCLUSIVE');
  assert.equal((await runCandidateShardReview({plan:p,infer:async()=>'{bad json'})).status,'BLOCKED');
  assert.equal((await runCandidateShardReview({plan:p,infer:answer,reviewerId:'Builder'})).status,'BLOCKED');
});

test('preserves actionable findings with exact slice and review digest for separate triage',async()=>{
  const p=source(1);
  const infer=async()=>JSON.stringify({verdict:'CHANGES_REQUESTED',findings:[{
    path:'code/review-0.mjs',line:1,severity:'medium',
    summary:'Synthetic session boundary finding',
    evidence:'Synthetic reviewer evidence on changed source',
    proposedFix:'Verify the session boundary before dispatch'
  }]});
  const result=await runCandidateShardReview({plan:p,infer});
  assert.equal(result.status,'CHANGES_REQUESTED');
  assert.equal(result.actionableFindings.length,1);
  assert.equal(result.actionableFindings[0].path,'code/review-0.mjs');
  assert.equal(result.actionableFindings[0].sliceId,1);
  assert.match(result.actionableFindings[0].reviewSha256,/^[a-f0-9]{64}$/u);
  assert.equal(result.githubApprovalSatisfied,false);
  assert.equal(result.mergeAuthorized,false);
});
test('potential secret content in a finding blocks the candidate rather than echoing it',async()=>{
  const p=source(1);
  const infer=async()=>JSON.stringify({verdict:'CHANGES_REQUESTED',findings:[{
    path:'code/review-0.mjs',line:1,severity:'high',
    summary:'Example credential leak',evidence:'api_key: synthetic-long-value-123456',
    proposedFix:'Remove the example credential'
  }]});
  const result=await runCandidateShardReview({plan:p,infer});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'AI09_SENSITIVE_OR_EXCESS_FINDINGS');
  assert.equal(result.actionableFindings,undefined);
});

test('inference callback emits source-bound hashes and declared model metadata, never raw prompts or responses',async()=>{
  const p=source(3), observed=[];
  const response=answer();
  const result=await runCandidateShardReview({plan:p,
    modelName:'qwen2.5-coder:3b',modelRevision:'candidate-test',
    infer:async()=>response,onInferenceEvidence:record=>observed.push(record)});
  assert.equal(result.status,'NO_ACTIONABLE_FINDINGS');
  assert.equal(result.inferenceAudit.count,3);
  assert.equal(observed.length,3);
  assert.equal(result.inferenceAudit.declaredProvenanceOnly,true);
  assert.equal(result.inferenceAudit.independentModelVerified,false);
  assert.equal(result.inferenceAudit.durableStorageVerified,false);
  const item=observed[0];
  assert.equal(item.sourceSha256,p.manifest.files[0].slices[0].sha256);
  assert.equal(item.responseSha256,createHash('sha256').update(response).digest('hex'));
  assert.equal(item.modelName,'qwen2.5-coder:3b');
  assert.match(item.requestSha256,/^[a-f0-9]{64}$/u);
  assert.match(item.startedAt,/^\d{4}-\d{2}-\d{2}T/u);
  assert.ok(!JSON.stringify(result.inferenceAudit).includes('BEGIN_UNTRUSTED_PATCH'));
  assert.ok(!JSON.stringify(result.inferenceAudit).includes('NO_FINDINGS'));
  assert.equal(result.githubApprovalSatisfied,false);
  assert.equal(result.mergeAuthorized,false);
});
test('inference proof sink failures or invalid model metadata fail closed',async()=>{
  const p=source(1);
  const failed=await runCandidateShardReview({plan:p,infer:answer,
    onInferenceEvidence:async()=>{throw Error('sink unavailable');}});
  assert.equal(failed.status,'BLOCKED');
  const invalid=await runCandidateShardReview({plan:p,infer:answer,
    modelName:'invalid model text'});
  assert.equal(invalid.status,'BLOCKED');
});

test('recomputed manifest hash cannot launder forged source blob and shard metadata',async()=>{
  const original=source(2);
  let invoked=0;
  const infer=async()=>{invoked++;return answer();};
  const refreshManifest=p=>{
    p.manifest.manifestSha256=createHash('sha256').update(JSON.stringify({
      ...p.manifest,manifestSha256:null})).digest('hex');
  };
  original.manifest.files[0].afterSha256='f'.repeat(64);
  refreshManifest(original);
  const blob=await runCandidateShardReview({plan:original,infer});
  assert.equal(blob.status,'BLOCKED');
  assert.equal(blob.reason,'AI09_FILE_BLOB_SHA_MISMATCH');
  assert.equal(invoked,0);
  const forgedShard=source(2);
  forgedShard.manifest.shards[0].digest='f'.repeat(64);
  refreshManifest(forgedShard);
  const shard=await runCandidateShardReview({plan:forgedShard,infer});
  assert.equal(shard.status,'BLOCKED');
  assert.equal(shard.reason,'AI09_SHARD_DIGEST_MISMATCH');
  assert.equal(invoked,0);
});
test('non-contiguous source slice offsets reject review before any inference',async()=>{
  const p=source(1);
  p.manifest.files[0].slices[0].start=1;
  p.manifest.manifestSha256=createHash('sha256').update(JSON.stringify({
    ...p.manifest,manifestSha256:null})).digest('hex');
  let invoked=0;
  const x=await runCandidateShardReview({plan:p,infer:async()=>{
    invoked++;return answer();
  }});
  assert.equal(x.status,'BLOCKED');
  assert.equal(invoked,0);
});
