import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
