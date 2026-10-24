import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { runOneAi09Batch, groundedReviewPrompt, auditAi09ClaimSupport, ai09AddedLineEvidenceIndex } from "../scripts/chat-actions-ai09-batch-runner.mjs";
import { aggregateIndependentBatchReceipts } from "../scripts/chat-actions-ai09-full-aggregate.mjs";
import { independentlyAuditAi09Claims } from "../scripts/chat-actions-ai09-independent-triage.mjs";
import { planCompleteAi09Review, collectAi09Evidence, assertNoWriteAuthority,
  subdivideVerifiedAi09Chunks }
 from "../scripts/chat-actions-ai09-multibatch.mjs";
import { reviewLocalPatch } from "../src/orchestrator/ai09-local-reviewer.mjs";
import { compareToPatch, compareToReviewChunks, consolidateChunkReviews }
 from "../src/orchestrator/ai09-pr-review-automation.mjs";
import { assertCompleteComparison } from "../scripts/goriq-ai09-compare-coverage.mjs";
import { holdUngroundedAdvisory, anchorAudit } from "../scripts/goriq-ai09-finding-anchors.mjs";

const SHA="a".repeat(40), HEAD="b".repeat(40);
const modules={
 reviewer:{reviewLocalPatch},
 batches:{compareToPatch,compareToReviewChunks,consolidateChunkReviews},
 coverage:{assertCompleteComparison},anchor:{holdUngroundedAdvisory,anchorAudit},
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
 const out=groundedReviewPrompt("Trusted review instructions\n"+original);
 assert.ok(out.includes(original));
 assert.ok(out.includes("exact added line"));
 assert.ok(out.includes("Never cite BEGIN_UNTRUSTED_PATCH"));
 assert.ok(out.includes("return INCONCLUSIVE"));
 assert.throws(()=>groundedReviewPrompt("user text only"),/INVALID_AI09_SOURCE_PROMPT/);
});

test("trusted AI09 prompt removes the example line 123 without altering real source diff",()=>{
 const source='BEGIN_UNTRUSTED_PATCH\n@@ -1 +1 @@\n-old\n+new\nEND_UNTRUSTED_PATCH';
 const prompt='Return {"path":"a","line":123}.\n'+source;
 const result=groundedReviewPrompt(prompt);
 assert.ok(result.includes('"line":null'));
 assert.ok(!result.includes('"line":123'));
 assert.ok(result.includes(source));
 assert.ok(result.includes("finding.summary MUST begin with 'Impact: '"));
});
test("finding support requires REAL new-side line + verbatim code quote + concrete impact",()=>{
 const patch='diff --git a/src/guard.ts b/src/guard.ts\n@@ -1,2 +1,2 @@\n unchanged\n-old\n+const checked = authorizeRequest(currentUser, resourceId);';
 const valid={path:"src/guard.ts",line:2,severity:"high",
  summary:"Impact: Unauthorized callers may access restricted resources when authorization is bypassed.",
  evidence:"The new line "+String.fromCharCode(96)+"authorizeRequest(currentUser, resourceId)"+String.fromCharCode(96)+" is used at the gate.",
  proposedFix:"Verify the authorization gate before returning data."};
 const grounded=auditAi09ClaimSupport([valid],patch,modules.anchor);
 assert.equal(grounded.complete,true);
 assert.equal(grounded.supported,1);
 assert.equal(grounded.checks[0].anchored,true);
 assert.equal(grounded.checks[0].impactExplained,true);
 assert.equal(grounded.evidenceClass,"AI_ASSERTED_NEEDS_INDEPENDENT_TRIAGE");
 assert.equal(auditAi09ClaimSupport([{...valid,line:123}],patch,modules.anchor).complete,false);
 assert.equal(auditAi09ClaimSupport([{...valid,evidence:"General risk, no code quote"}],patch,modules.anchor).complete,false);
 assert.equal(auditAi09ClaimSupport([{...valid,summary:"Potential issue"}],patch,modules.anchor).complete,false);
 assert.equal(auditAi09ClaimSupport([{...valid,proposedFix:"Fix"}],patch,modules.anchor).complete,false);
});
test("real code quote without a concrete consequence remains INCONCLUSIVE and findings retained",async()=>{
 const plan=planCompleteAi09Review(comparison(1,4),SHA,HEAD,modules);
 const manifest=manifestFor(plan), code=plan.batches[0].chunks[0].patch;
 const added=code.split("\n").find(x=>x.startsWith("+")&&!x.startsWith("+++"));
 assert.ok(added);
 const report=await runOneAi09Batch({plan,manifest,index:0,modules,infer:async()=>
  JSON.stringify({verdict:"CHANGES_REQUESTED",findings:[{
   path:plan.batches[0].paths[0],line:1,severity:"medium",
   summary:"Concern without consequence",
   evidence:"Quoted code "+String.fromCharCode(96)+added.slice(1,50)+String.fromCharCode(96),
   proposedFix:"Check actual code path before releasing."}]})});
 assert.equal(report.status,"INCONCLUSIVE");
 assert.equal(report.chunkReports[0].status,"CHANGES_REQUESTED");
 assert.equal(report.chunkReports[0].findings.length,1);
 assert.equal(report.diagnostic[0].anchor.complete,false);
 assert.equal(report.diagnostic[0].anchor.checks[0].impactExplained,false);
 assert.equal(report.githubApprovalSatisfied,false);
 assert.equal(report.mergeAuthorized,false);
});

test("trusted prompt removes fixed example only, never edits source diff with line 123 literal",()=>{
 const patch='BEGIN_UNTRUSTED_PATCH\n@@ -1 +1 @@\n-const x=1;\n+const hint={"line":123};\nEND_UNTRUSTED_PATCH';
 const input='Model schema {"line":123}\n'+patch;
 const out=groundedReviewPrompt(input);
 assert.ok(out.includes('Model schema {"line":null}'));
 assert.ok(out.includes('+const hint={"line":123};'));
 assert.equal(out.split('+const hint={"line":123};').length,2);
});
test("independent verifier never proves impact even if model finds an exact quoted added line",async()=>{
 const plan=planCompleteAi09Review(comparison(1,4),SHA,HEAD,modules);
 const manifest=manifestFor(plan);
 const chunk=plan.batches[0].chunks[0];
 const line=chunk.patch.split("\n").find(x=>x.startsWith("+")&&!x.startsWith("+++"));
 assert.ok(line);
 const original=line.slice(1,45);
 const quote=String.fromCharCode(96)+original+String.fromCharCode(96);
 const receipt=await runOneAi09Batch({plan,manifest,index:0,modules,infer:async()=>JSON.stringify({
  verdict:"CHANGES_REQUESTED",findings:[{
   path:chunk.paths[0],line:1,severity:"medium",
   summary:"Impact: A logic defect may cause an incorrect response for valid input.",
   evidence:"Code "+quote+" is potentially implicated.",
   proposedFix:"Verify the behavior using a separately executed regression.",
  }],
 })});
 const triage=independentlyAuditAi09Claims({plan,receipts:[receipt],anchorModule:modules.anchor});
 assert.equal(triage.status,"REQUIRES_INDEPENDENT_VERIFICATION");
 assert.equal(triage.groundedClaims,1);
 assert.equal(triage.pendingIndependentVerification,1);
 assert.equal(triage.independentImpactVerified,0);
 assert.equal(triage.claims[0].status,"PENDING_INDEPENDENT_BEHAVIORAL_VERIFICATION");
 assert.equal(triage.claims[0].readyForAutomaticRepair,false);
 const aggregate=aggregateIndependentBatchReceipts({plan,manifest,receipts:[receipt],modules});
 assert.equal(aggregate.acceptedReview,false);
 assert.notEqual(aggregate.status,"NO_ACTIONABLE_FINDINGS");
 assert.equal(aggregate.independentTriage.pendingIndependentVerification,1);
 assert.equal(aggregate.githubApprovalSatisfied,false);
 assert.equal(aggregate.mergeAuthorized,false);
});
test("independent verifier keeps incorrect line-number model warnings ungrounded and blocked for automatic repair",async()=>{
 const plan=planCompleteAi09Review(comparison(1,4),SHA,HEAD,modules);
 const manifest=manifestFor(plan);
 const receipt=await runOneAi09Batch({plan,manifest,index:0,modules,infer:async()=>JSON.stringify({
  verdict:"CHANGES_REQUESTED",findings:[{
   path:plan.batches[0].paths[0],line:123,severity:"high",
   summary:"Impact: This program may expose private data under some conditions.",
   evidence:"The code is dangerous, without a real quotation.",
   proposedFix:"Inspect the exact production source and reproduce.",
  }],
 })});
 const triage=independentlyAuditAi09Claims({plan,receipts:[receipt],anchorModule:modules.anchor});
 assert.equal(triage.groundedClaims,0);
 assert.equal(triage.claims[0].status,"UNGROUNDED_MODEL_CLAIM");
 assert.equal(triage.claims[0].readyForAutomaticRepair,false);
 assert.equal(triage.githubApprovalSatisfied,false);
 const aggregate=aggregateIndependentBatchReceipts({plan,manifest,receipts:[receipt],modules});
 assert.equal(aggregate.acceptedReview,false);
 assert.notEqual(aggregate.status,"NO_ACTIONABLE_FINDINGS");
});
test("independent verification catches stale and duplicate received batches",async()=>{
 const plan=planCompleteAi09Review(comparison(15,70),SHA,HEAD,modules);
 const manifest=manifestFor(plan);
 const receipts=[];
 for(let i=0;i<plan.batchCount;i++){
  receipts.push(await runOneAi09Batch({plan,manifest,index:i,modules,infer:allow}));
 }
 const clean=independentlyAuditAi09Claims({plan,receipts,anchorModule:modules.anchor});
 assert.equal(clean.status,"NO_MODEL_CLAIMS");
 assert.equal(clean.inspectedBatches,plan.batchCount);
 assert.equal(clean.invalidReceipts,0);
 const duplicated=independentlyAuditAi09Claims({plan,receipts:[...receipts,receipts[0]],anchorModule:modules.anchor});
 assert.equal(duplicated.status,"BLOCKED");
 const stale=independentlyAuditAi09Claims({plan,receipts:[{...receipts[0],headSha:"c".repeat(40)},...receipts.slice(1)],anchorModule:modules.anchor});
 assert.equal(stale.status,"BLOCKED");
});

test("actual new-side hunk line numbers survive split source chunks without altering reviewed bytes",()=>{
 const path="src/real.ts";
 const first={fileIndex:0,paths:[path],
  source:"@@ -1,3 +10,4 @@\n const a = 1;\n-old\n+const b = 2;"};
 const second={fileIndex:0,paths:[path],
  source:"+const c = 3;\n return 1;"};
 const patch="diff --git a/"+path+" b/"+path+"\n"+
   [first.source,second.source].join("\n");
 const batch={paths:[path],chunks:[first,second],patch};
 const a=ai09AddedLineEvidenceIndex(batch,first);
 const b=ai09AddedLineEvidenceIndex(batch,second);
 assert.equal(a.path,path);
 assert.equal(a.fullAddedLineCount,1);
 assert.equal(b.fullAddedLineCount,1);
 assert.ok(a.evidenceHint.includes('[11,"const b = 2;"]'));
 assert.ok(b.evidenceHint.includes('[12,"const c = 3;"]'));
 assert.equal(batch.patch,patch);
 assert.equal(a.evidenceClass,"MACHINE_VERIFIED_LINE_COORDINATES_ONLY");
});
test("line indices require canonical Git source and reject untrusted scope swaps",()=>{
 const one={fileIndex:0,paths:["src/expected.js"],source:"@@ -0,0 +1 @@\n+export const ok = true;"};
 const batch={paths:["src/expected.js"],chunks:[one],
  patch:"diff --git a/src/expected.js b/src/expected.js\n"+one.source};
 assert.ok(ai09AddedLineEvidenceIndex(batch,one).evidenceHint.includes('[1,"export const ok = true;"]'));
 assert.throws(()=>ai09AddedLineEvidenceIndex({...batch,patch:"diff --git a/src/other.js b/src/other.js\n"+one.source},one),
  /AI09_CANONICAL_DIFF_NOT_FOUND/);
 assert.throws(()=>ai09AddedLineEvidenceIndex(batch,{...one}),/INVALID_AI09_EVIDENCE_INDEX_SCOPE/);
 assert.throws(()=>ai09AddedLineEvidenceIndex({...batch,paths:["src/other.js"]},one),/AI09_EVIDENCE_PATH_MISMATCH/);
});
test("reviewed model prompt includes machine-counted line coordinates, but never authorizes merge",async()=>{
 const plan=planCompleteAi09Review(comparison(1,4),SHA,HEAD,modules);
 const manifest=manifestFor(plan),seen=[];
 const r=await runOneAi09Batch({plan,manifest,index:0,modules,infer:async prompt=>{
  seen.push(prompt);
  return JSON.stringify({verdict:"NO_FINDINGS",findings:[]});
 }});
 assert.equal(r.status,"NO_ACTIONABLE_FINDINGS");
 assert.equal(r.githubApprovalSatisfied,false);
 assert.equal(r.mergeAuthorized,false);
 assert.ok(seen.length>0);
 assert.ok(seen[0].includes("ADDED_LINE_COORDINATES_FROM_TRUSTED_GIT_HUNKS"));
 assert.ok(seen[0].includes('fixture_0_0'));
 assert.ok(seen[0].includes("\nThe location index"));
 assert.ok(r.diagnostic.every(x=>x.trustedLineIndexCount>0));
});

test("verified 4KiB native review slices subdivide losslessly to <=2300 bytes before model inference",()=>{
 const c=comparison(1,70);
 const native=compareToReviewChunks(c,SHA,HEAD);
 assert.ok(native.chunks.some(x=>Buffer.byteLength(x.patch,"utf8")>2300));
 const split=subdivideVerifiedAi09Chunks(native);
 assert.ok(split.chunks.length>native.chunks.length);
 assert.equal(split.patch,native.patch);
 assert.equal(split.patchSha256,native.patchSha256);
 assert.deepEqual(split.paths,native.paths);
 assert.equal(split.chunks.map(x=>x.source).join("\n"),
  native.chunks.map(x=>x.source).join("\n"));
 assert.ok(split.chunks.every(x=>Buffer.byteLength(x.patch,"utf8")<=2300));
 assert.ok(split.chunks.every(x=>Buffer.byteLength(x.patch,"utf8")<=4096));
});
test("multi-file source, actual hunk context, and continuation lines survive native source subdivision",()=>{
 const c=comparison(2,60);
 const native=compareToReviewChunks(c,SHA,HEAD);
 const split=subdivideVerifiedAi09Chunks(native);
 for(let i=0;i<c.files.length;i++){
  assert.equal(split.chunks.filter(x=>x.fileIndex===i).map(x=>x.source).join("\n"),
   c.files[i].patch);
  assert.ok(split.chunks.filter(x=>x.fileIndex===i).every(x=>
   x.patch.includes("diff --git a/"+c.files[i].filename)));
 }
 assert.deepEqual(split.paths,c.files.map(f=>f.filename));
});
test("the full multi-batch plan independently verifies native source hashes while using smaller Qwen inputs",()=>{
 const c=comparison(15,70);
 const native=compareToPatch(c,SHA,HEAD);
 const plan=planCompleteAi09Review(c,SHA,HEAD,modules);
 assert.equal(plan.patchSha256,native.patchSha256);
 assert.equal(plan.batches.map(b=>b.patch).join("\n"),native.patch);
 assert.equal(plan.totalChunks,plan.batches.flatMap(b=>b.chunks).length);
 assert.ok(plan.totalChunks>24);
 assert.ok(plan.batches.every(b=>b.chunks.length<=24));
 assert.ok(plan.batches.flatMap(b=>b.chunks).every(c=>
   Buffer.byteLength(c.patch,"utf8")<=2300));
});
test("splitting refuses oversized source lines, forged native chunk scope, and missing hunk context",()=>{
 const c=comparison(1,4);
 const native=compareToReviewChunks(c,SHA,HEAD);
 assert.throws(()=>subdivideVerifiedAi09Chunks(native,100),/INVALID_AI09_SUBDIVISION_SCOPE/);
 assert.throws(()=>subdivideVerifiedAi09Chunks({
  ...native,chunks:[{...native.chunks[0],paths:["src/forged.ts"]}]},2300),
  /INVALID_NATIVE_AI09_SOURCE_CHUNK/);
 assert.throws(()=>subdivideVerifiedAi09Chunks({
  ...native,chunks:[{...native.chunks[0],source:"+const noContext = 1;"}]},2300),
  /MISSING_AI09_HUNK_CONTEXT/);
 const giant={...native,chunks:[{...native.chunks[0],
  source:"@@ -1 +1 @@\n+"+"Q".repeat(2500)}]};
 assert.throws(()=>subdivideVerifiedAi09Chunks(giant,2300),
  /UNREVIEWABLE_AI09_SOURCE_LINE/);
});
