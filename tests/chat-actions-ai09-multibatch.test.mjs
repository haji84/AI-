import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { runOneAi09Batch, groundedReviewPrompt } from "../scripts/chat-actions-ai09-batch-runner.mjs";
import { aggregateIndependentBatchReceipts } from "../scripts/chat-actions-ai09-full-aggregate.mjs";
import { planCompleteAi09Review, collectAi09Evidence, assertNoWriteAuthority }
 from "../scripts/chat-actions-ai09-multibatch.mjs";
import { reviewLocalPatch } from "../src/orchestrator/ai09-local-reviewer.mjs";
import { compareToPatch, compareToReviewChunks, consolidateChunkReviews }
 from "../src/orchestrator/ai09-pr-review-automation.mjs";
import { assertCompleteComparison } from "../scripts/goriq-ai09-compare-coverage.mjs";
import { holdUngroundedAdvisory } from "../scripts/goriq-ai09-finding-anchors.mjs";

const SHA="a".repeat(40), HEAD="b".repeat(40);
const modules={
 reviewer:{reviewLocalPatch},
 batches:{compareToPatch,compareToReviewChunks,consolidateChunkReviews},
 coverage:{assertCompleteComparison},anchor:{holdUngroundedAdvisory},
};
function comparison(fileCount=15,linesPerFile=70) {
 const files=Array.from({length:fileCount},(_,i)=>{
  const adds=Array.from({length:linesPerFile},(_,j)=>"+fixture_"+i+"_"+j+" = "+"x".repeat(57));
  return {
   filename:"src/sample/part-"+String(i).padStart(2,"0")+".ts",
   status:"modified",additions:linesPerFile,deletions:1,
   patch:"@@ -1 +1,"+linesPerFile+" @@\n-old_"+i+"\n"+adds.join("\n"),
  };
 });
 return {status:"ahead",ahead_by:1,total_commits:1,files};
}
const allow=async()=>JSON.stringify({verdict:"NO_FINDINGS",findings:[]});
async function fillReports(plan) {
 return Promise.all(plan.batches.map(async b=>{
  const chunkReports=[];
  for(const chunk of b.chunks){
   chunkReports.push(await reviewLocalPatch({
    baseSha:SHA,headSha:HEAD,makerRole:"Builder",
    paths:chunk.paths,patch:chunk.patch,infer:allow,
   }));
  }
  return {index:b.index,patchSha256:b.patchSha256,chunkReports};
 }));
}
test("native single review rejects >24 chunks while lossless partition accepts all files",()=>{
 const c=comparison();
 assert.throws(()=>compareToReviewChunks(c,SHA,HEAD),/review_chunk_budget_exhausted/);
 const plan=planCompleteAi09Review(c,SHA,HEAD,modules);
 assert.ok(plan.totalChunks>24);
 assert.ok(plan.batchCount>=2);
 assert.deepEqual(plan.paths,c.files.map(f=>f.filename));
 assert.equal(plan.batches.flatMap(b=>b.paths).length,c.files.length);
 assert.ok(plan.batches.every(b=>b.chunks.length<=24));
 assert.ok(plan.batches.flatMap(b=>b.chunks).every(c=>Buffer.byteLength(c.patch,"utf8")<=4096));
 assert.equal(plan.batches.map(b=>b.patch).join("\n"),compareToPatch(c,SHA,HEAD).patch);
 assert.equal(plan.githubApprovalSatisfied,false);
 assert.equal(plan.mergeAuthorized,false);
});
test("all separately reviewed batches can be recomposed with exact native hashes, still without merge authority",async()=>{
 const plan=planCompleteAi09Review(comparison(),SHA,HEAD,modules);
 const reports=await fillReports(plan);
 const result=collectAi09Evidence(plan,reports,modules);
 assert.equal(result.status,"NO_ACTIONABLE_FINDINGS");
 assert.equal(result.receivedBatches,result.requiredBatches);
 assert.equal(result.observations.every(r=>r.chunkReceipts===r.expectedChunks),true);
 assertNoWriteAuthority(result);
});
test("partial batch evidence is blocked, never a silent clean review",async()=>{
 const plan=planCompleteAi09Review(comparison(),SHA,HEAD,modules);
 const reports=await fillReports(plan);
 const r=collectAi09Evidence(plan,reports.slice(0,-1),modules);
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.githubApprovalSatisfied,false);
});
test("one missing AI09 chunk inside a batch blocks even when other batches pass",async()=>{
 const plan=planCompleteAi09Review(comparison(),SHA,HEAD,modules);
 const reports=await fillReports(plan);
 reports[0].chunkReports.pop();
 const r=collectAi09Evidence(plan,reports,modules);
 assert.equal(r.status,"BLOCKED");
});
test("duplicate or stale batch records cannot promote a passing review",async()=>{
 const plan=planCompleteAi09Review(comparison(),SHA,HEAD,modules);
 const reports=await fillReports(plan);
 assert.equal(collectAi09Evidence(plan,[...reports,reports[0]],modules).status,"BLOCKED");
 assert.equal(collectAi09Evidence(plan,reports.map((r,i)=>i===0?{...r,patchSha256:"c".repeat(64)}:r),modules).status,"BLOCKED");
});
test("earlier model findings remain visible after a later batch is blocked",async()=>{
 const plan=planCompleteAi09Review(comparison(),SHA,HEAD,modules);
 const reports=await fillReports(plan);
 const first=reports[0].chunkReports[0];
 first.status="CHANGES_REQUESTED";
 first.findings=[{id:"AI09-1",path:plan.batches[0].chunks[0].paths[0],
  severity:"medium",line:1,summary:"Potential arithmetic regression",
  evidence:"fixture_0_0",proposedFix:"Verify actual test behavior"}];
 first.blockers=["model_findings_require_action"];
 reports[reports.length-1].chunkReports.pop();
 const r=collectAi09Evidence(plan,reports,modules);
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.unresolvedFindings.length,1);
 assert.equal(r.unresolvedFindings[0].evidenceClass,"AI_ASSERTED_UNVERIFIED");
});
test("unreviewable oversized hunk line and incomplete GitHub statistics still fail closed",()=>{
 const c=comparison(1,4);
 c.files[0].patch+="\n+"+"z".repeat(4400);
 c.files[0].additions++;
 assert.throws(()=>planCompleteAi09Review(c,SHA,HEAD,modules),/unreviewable_oversized_line/);
 const d=comparison(1,4);
 d.files[0].additions++;
 assert.throws(()=>planCompleteAi09Review(d,SHA,HEAD,modules),/incomplete_github_patch/);
});
test("an invalid plan or claimed model merge power is rejected",()=>{
 assert.throws(()=>planCompleteAi09Review(comparison(1),SHA,"not_sha",modules),/INVALID_FULL_REVIEW_SCOPE/);
 assert.throws(()=>assertNoWriteAuthority({mergeAuthorized:true,githubApprovalSatisfied:false}),/AI09_MUST_NOT_GRANT_AUTHORITY/);
});

test("full PR exceeding native 120KiB is composed ONLY from native per-batch verified patches",()=>{
 const c=comparison(21,85);
 assert.throws(()=>compareToPatch(c,SHA,HEAD),/diff_exceeds_local_review_budget/);
 const plan=planCompleteAi09Review(c,SHA,HEAD,modules);
 assert.equal(plan.paths.length,21);
 assert.ok(plan.batchCount>=2);
 assert.ok(plan.totalChunks>24);
 const patch=c.files.map(f=>"diff --git a/"+f.filename+" b/"+f.filename+"\n"+f.patch).join("\n");
 assert.equal(plan.batches.map(b=>b.patch).join("\n"),patch);
 assert.ok(plan.batches.every(b=>Buffer.byteLength(b.patch,"utf8")<=120*1024));
});

function manifestFor(plan) {
 return {
  headSha:plan.headSha,baseSha:plan.baseSha,
  batchCount:plan.batchCount,patchSha256:plan.patchSha256,
  manifestSha:"f".repeat(64),
  batches:plan.batches.map(b=>({index:b.index,patchSha256:b.patchSha256})),
 };
}
test("independent batch artifacts recombine into a complete PR advisory with no merge authority",async()=>{
 const plan=planCompleteAi09Review(comparison(15,70),SHA,HEAD,modules);
 const manifest=manifestFor(plan);
 const receipts=[];
 for(let i=0;i<plan.batchCount;i++){
  receipts.push(await runOneAi09Batch({plan,manifest,index:i,modules,infer:allow}));
 }
 const out=aggregateIndependentBatchReceipts({plan,manifest,receipts,modules});
 assert.equal(out.acceptedReview,true);
 assert.equal(out.status,"NO_ACTIONABLE_FINDINGS");
 assert.equal(out.totalChunks,plan.totalChunks);
 assert.equal(out.reviewedBatchCount,plan.batchCount);
 assert.equal(out.githubApprovalSatisfied,false);
 assert.equal(out.mergeAuthorized,false);
});
test("aggregator blocks stale artifact, missing batch or duplicate batch",async()=>{
 const plan=planCompleteAi09Review(comparison(15,70),SHA,HEAD,modules);
 const manifest=manifestFor(plan),receipts=[];
 for(let i=0;i<plan.batchCount;i++){
  receipts.push(await runOneAi09Batch({plan,manifest,index:i,modules,infer:allow}));
 }
 const missing=aggregateIndependentBatchReceipts({plan,manifest,receipts:receipts.slice(1),modules});
 assert.equal(missing.status,"BLOCKED");
 assert.equal(missing.acceptedReview,false);
 assert.deepEqual(missing.missingBatchIndexes,[0]);
 const repeated=aggregateIndependentBatchReceipts({plan,manifest,receipts:[...receipts,receipts[0]],modules});
 assert.equal(repeated.status,"BLOCKED");
 assert.equal(repeated.invalidReceiptCount,1);
 const stale=aggregateIndependentBatchReceipts({plan,manifest,receipts:receipts.map((x,i)=>i?x:{...x,manifestSha:"a".repeat(64)}),modules});
 assert.equal(stale.status,"BLOCKED");
});
test("AI09 invalid or truncated model response remains BLOCKED with artifact evidence",async()=>{
 const plan=planCompleteAi09Review(comparison(15,70),SHA,HEAD,modules);
 const manifest=manifestFor(plan);
 const r=await runOneAi09Batch({plan,manifest,index:0,modules,infer:async()=>"{truncated"});
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.reviewedChunks,plan.batches[0].chunkCount);
 assert.ok(r.chunkReports.every(chunk=>chunk.status==="BLOCKED"));
 assert.ok(r.diagnostic.every(x=>x.retried===true));
 const out=aggregateIndependentBatchReceipts({plan,manifest,receipts:[r],modules});
 assert.equal(out.status,"BLOCKED");
 assert.equal(out.acceptedReview,false);
});

test("single transient inference error gets exactly one retry then a real reviewer verdict",async()=>{
 const plan=planCompleteAi09Review(comparison(1,4),SHA,HEAD,modules);
 const manifest=manifestFor(plan);
 let count=0;
 const report=await runOneAi09Batch({plan,manifest,index:0,modules,infer:async()=>{
  count++;
  if(count===1)throw Error("one temporary local inference outage");
  return JSON.stringify({verdict:"NO_FINDINGS",findings:[]});
 }});
 assert.equal(report.status,"NO_ACTIONABLE_FINDINGS");
 assert.equal(count,2);
 assert.equal(report.diagnostic[0].firstStatus,"BLOCKED");
 assert.equal(report.diagnostic[0].retried,true);
 assert.equal(report.githubApprovalSatisfied,false);
});
test("actionable AI09 findings are retained, not retried away as clean",async()=>{
 const plan=planCompleteAi09Review(comparison(1,4),SHA,HEAD,modules);
 const manifest=manifestFor(plan);
 let count=0;
 const report=await runOneAi09Batch({plan,manifest,index:0,modules,infer:async()=>{
  count++;
  return JSON.stringify({verdict:"CHANGES_REQUESTED",findings:[{
   path:plan.batches[0].paths[0],line:123,severity:"high",
   summary:"Unverified security concern",evidence:"No quoted addition",
   proposedFix:"Investigate actual source" }]});
 }});
 assert.equal(count,1);
 assert.equal(report.status,"INCONCLUSIVE");
 assert.equal(report.diagnostic[0].firstStatus,"CHANGES_REQUESTED");
 assert.equal(report.diagnostic[0].anchor.complete,false);
 assert.equal(report.chunkReports[0].findings.length,1);
});

test("grounded AI09 prompt forbids guessed review lines and keeps the full untrusted diff",()=>{
 const original="BEGIN_UNTRUSTED_PATCH\n@@ -1 +1 @@\n-old\n+new\nEND_UNTRUSTED_PATCH";
 const out=groundedReviewPrompt(original);
 assert.ok(out.startsWith(original));
 assert.ok(out.includes("exact added code"));
 assert.ok(out.includes("Never use guessed line 123"));
 assert.ok(out.includes("report INCONCLUSIVE"));
 assert.throws(()=>groundedReviewPrompt("user text only"),/INVALID_AI09_SOURCE_PROMPT/);
});
