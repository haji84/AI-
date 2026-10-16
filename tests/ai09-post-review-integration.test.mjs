import assert from "node:assert/strict";
import test from "node:test";
import { publishReceipt } from "../scripts/goriq-ai09-post-review.mjs";
import {
  compareToPatch, reviewReceipt, commentMarker
} from "../src/orchestrator/ai09-pr-review-automation.mjs";

const repo = "haji84/AI-";
const base = "a".repeat(40), head = "b".repeat(40), trusted = "c".repeat(40);
const c = { repository:repo, prNumber:1799, headSha:head,
  baseSha:base, trustedSha:trusted, ciRunId:777, token:"fixture-never-used" };
const comparison = { status:"ahead", ahead_by:1,total_commits:1,
  base_commit:{sha:base}, commits:[{sha:head}],
  files:[{filename:"src/a.ts", additions:1, deletions:0,
    patch:"@@ -0,0 +1 @@\n+export const a = 1;"}]};
const d = compareToPatch(comparison,base,head);
const result = {
  version:1, reviewer:"AI-09", scope:{baseSha:base,headSha:head,
    paths:d.paths,patchSha256:d.patchSha256},
  status:"NO_ACTIONABLE_FINDINGS", findings:[], blockers:[],
  evidenceClass:"AI_ASSERTED", githubApprovalSatisfied:false,
  independentGitHubAccountVerified:false, physicalEvidenceVerified:false,
  mergeAuthorized:false
};
function receipt(r=result) {return reviewReceipt({
  repository:repo,prNumber:1799,headSha:head,baseSha:base,
  trustedSha:trusted,ciRunId:777,ciConclusion:"success",result:r
});}
function ci() {return {id:777,name:"CI",event:"pull_request",status:"completed",
  conclusion:"success",head_sha:head,repository:{id:31,full_name:repo},
  pull_requests:[{number:1799,head:{sha:head,repo:{id:31}},base:{sha:base,repo:{id:31}}}]};}
function pr() {return {number:1799,state:"open",
  head:{sha:head,repo:{full_name:repo}},base:{sha:base,repo:{full_name:repo}}};}
function fakeApi({oldComments=[],prResponse=pr(),ciResponse=ci(),compareResponse=comparison}={}) {
  const calls=[];
  const api=async (_c,path,method="GET",body)=>{
    calls.push({path,method,body});
    if(path==="/actions/runs/777")return ciResponse;
    if(path==="/pulls/1799")return prResponse;
    if(path==="/compare/"+base+"..."+head)return compareResponse;
    if(path==="/issues/1799/comments?per_page=100&page=1")return oldComments;
    if(path==="/issues/1799/comments" && method==="POST")return {id:1};
    throw Error("UNEXPECTED_API_CALL");
  };
  return {api,calls};
}
test("real hosted poster validation path can write exactly one advisory comment through an isolated stub", async ()=>{
  const f=fakeApi();
  const status=await publishReceipt(c,receipt(),f.api);
  assert.equal(status,"POSTED");
  const writes=f.calls.filter(x=>x.method!=="GET");
  assert.equal(writes.length,1);
  assert.equal(writes[0].path,"/issues/1799/comments");
  assert.ok(writes[0].body.body.startsWith(commentMarker(1799,head,base)));
  assert.match(writes[0].body.body,/GitHub approval satisfied: NO/);
  assert.match(writes[0].body.body,/Merge authorized: NO/);
});
test("existing head-scoped AI09 comment causes idempotent skip, not second POST", async ()=>{
  const f=fakeApi({oldComments:[{user:{login:"github-actions[bot]"},body:commentMarker(1799,head,base)+"\nrecorded"}]});
  assert.equal(await publishReceipt(c,receipt(),f.api),"ALREADY_RECORDED");
  assert.equal(f.calls.filter(x=>x.method!=="GET").length,0);
});
test("untrusted receipt cannot even perform GitHub read", async ()=>{
  const f=fakeApi();
  await assert.rejects(publishReceipt(c,receipt({...result,mergeAuthorized:true}),f.api),/untrusted_or_stale_review_receipt/);
  assert.equal(f.calls.length,0);
});
test("stale current PR SHA safely skips without a comment", async ()=>{
  const f=fakeApi({prResponse:{...pr(),head:{sha:trusted,repo:{full_name:repo}}}});
  assert.equal(await publishReceipt(c,receipt(),f.api),"STALE_PR");
  assert.equal(f.calls.filter(x=>x.method!=="GET").length,0);
});
test("forge a CI success or truncate a patch and publication must fail closed", async ()=>{
  const failed=fakeApi({ciResponse:{...ci(),conclusion:"failure"}});
  await assert.rejects(publishReceipt(c,receipt(),failed.api),/untrusted_ci_verdict_or_pr_link/);
  const changed=fakeApi({compareResponse:{...comparison,files:[{...comparison.files[0],additions:2}]}});
  await assert.rejects(publishReceipt(c,receipt(),changed.api),/incomplete_github_patch/);
  assert.equal(changed.calls.filter(x=>x.method!=="GET").length,0);
});
test("unsafe direct credential logging cannot be published as clean even with valid model assertion",async ()=>{
  const compare = {...comparison,files:[{filename:"src/a.ts",additions:1,deletions:0,
    patch:"@@ -0,0 +1 @@\n+console.log(request.headers.authorization);"}]};
  const trustedDigest=compareToPatch(compare,base,head);
  const forgedReceipt=receipt({...result,scope:{baseSha:base,headSha:head,
    paths:trustedDigest.paths,patchSha256:trustedDigest.patchSha256}});
  const f=fakeApi({compareResponse:compare});
  await assert.rejects(publishReceipt(c,forgedReceipt,f.api),/deterministic_sensitive_logging_risk/);
  assert.equal(f.calls.filter(x=>x.method!=="GET").length,0);
});
