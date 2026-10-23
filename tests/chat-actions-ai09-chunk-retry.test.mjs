import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { validatePilotReviewEvent, prepareBoundedReview, reviewWithLocalModel,
  PILOT_BASE_SHA } from "../scripts/chat-actions-ai09-chunk-retry.mjs";
import { reviewLocalPatch } from "../src/orchestrator/ai09-local-reviewer.mjs";
import { compareToReviewChunks, consolidateChunkReviews,
  makeBlockedReview } from "../src/orchestrator/ai09-pr-review-automation.mjs";
import { assertCompleteComparison } from "../scripts/goriq-ai09-compare-coverage.mjs";
import { holdUngroundedAdvisory } from "../scripts/goriq-ai09-finding-anchors.mjs";
const HEAD="a".repeat(40);
const modules={
 reviewer:{reviewLocalPatch},
 batches:{compareToReviewChunks,consolidateChunkReviews,makeBlockedReview},
 coverage:{assertCompleteComparison},
 anchor:{holdUngroundedAdvisory},
};
const scope={number:1866,pull_request:{number:1866,state:"open",
 head:{sha:HEAD,ref:"codex/1865-pr-reuse-advisory",repo:{full_name:"haji84/AI-"}},
 base:{sha:"b".repeat(40),ref:"main",repo:{full_name:"haji84/AI-"}}}};
const compare={base_commit:{sha:PILOT_BASE_SHA},commits:[{sha:HEAD}],
 status:"ahead",ahead_by:1,total_commits:1,files:[
  {filename:"src/example.ts",additions:1,deletions:1,patch:"@@ -1 +1 @@\n-old\n+new"},
 ]};
test("isolated reviewer enforces real same-repository pinned PR and head",()=>{
 assert.deepEqual(validatePilotReviewEvent(scope,"haji84/AI-"),{
  headSha:HEAD,mainSha:"b".repeat(40),
 });
 assert.throws(()=>validatePilotReviewEvent({...scope,number:1867},"haji84/AI-"),/UNTRUSTED_PR_REVIEW_EVENT/);
 assert.throws(()=>validatePilotReviewEvent(scope,"attacker/repo"),/UNTRUSTED_PR_REVIEW_EVENT/);
});
test("trusted chunker keeps complete patch coverage and bounds model input",async()=>{
 const p=await prepareBoundedReview(compare,HEAD,modules);
 assert.equal(p.paths.length,1);
 assert.ok(p.chunks.length>=1);
 assert.ok(p.chunks.every(c=>Buffer.byteLength(c.patch,"utf8")<=4096));
 assert.ok(p.chunks.every(c=>c.paths[0]==="src/example.ts"));
});
test("missing hunk bytes fail closed before consulting AI",async()=>{
 const bad={...compare,files:[{...compare.files[0],additions:2}]};
 await assert.rejects(()=>prepareBoundedReview(bad,HEAD,modules),/incomplete_github_patch/);
});
test("mismatched compare revision is not a valid AI09 review",async()=>{
 await assert.rejects(()=>prepareBoundedReview({...compare,commits:[{sha:"c".repeat(40)}]},HEAD,modules),
 /REVIEW_COMPARISON_MISMATCH/);
});
test("every chunk must produce a valid AI09 result to report no findings",async()=>{
 const p=await prepareBoundedReview(compare,HEAD,modules);
 const r=await reviewWithLocalModel({prepared:p,headSha:HEAD,modules,
  infer:async()=>JSON.stringify({verdict:"NO_FINDINGS",findings:[]})});
 assert.equal(r.status,"NO_ACTIONABLE_FINDINGS");
 assert.equal(r.githubApprovalSatisfied,false);
 assert.equal(r.mergeAuthorized,false);
 assert.equal(r.evidenceClass,"AI_ASSERTED");
});
test("model JSON errors preserve BLOCKED rather than claiming reviewed",async()=>{
 const p=await prepareBoundedReview(compare,HEAD,modules);
 const r=await reviewWithLocalModel({prepared:p,headSha:HEAD,modules,
  infer:async()=>"{not-json"});
 assert.equal(r.status,"BLOCKED");
 assert.ok(r.blockers.length>0);
});
test("indeterminate model verdict never becomes PASS",async()=>{
 const p=await prepareBoundedReview(compare,HEAD,modules);
 const r=await reviewWithLocalModel({prepared:p,headSha:HEAD,modules,
  infer:async()=>JSON.stringify({verdict:"INCONCLUSIVE",findings:[]})});
 assert.equal(r.status,"INCONCLUSIVE");
});
