import test from "node:test";
import assert from "node:assert/strict";
import { auditRealPr } from "../scripts/chat-actions-live-pr-audit.mjs";
const repo="sandbox/example",A="a".repeat(40),B="b".repeat(40);
const pull={number:1866,state:"open",body:"Refs #1865. Read-only advisory",head:{sha:B,ref:"sandbox-branch",repo:{full_name:repo}},
  base:{sha:A,ref:"main",repo:{full_name:repo}}};
const event={eventName:"pull_request",payload:{number:1866,pull_request:pull}};
const bot={user:{login:"github-actions[bot]"},
  body:"<!-- GORIQ_AI09_ADVISORY_V2 PR=1866 HEAD="+B+" BASE="+A+" -->\n"+
    "**Status:** INCONCLUSIVE\n**Evidence class:** AI_ASSERTED\n**GitHub approval satisfied: NO**"};
function fakeFetch({pr=pull,comments=[]}={}) {
  const seen=[];
  const fetchImpl=async (url,options)=>{
    seen.push({url,options});
    if(url.endsWith("/pulls/1866"))return {ok:true,json:async()=>pr};
    if(url.includes("/issues/1866/comments?"))return {ok:true,json:async()=>comments};
    throw Error("UNEXPECTED_URL");
  };
  return {fetchImpl,seen};
}
test("reads actual current PR identity through public API adapter with no token or writes",async()=>{
 const f=fakeFetch();
 const x=await auditRealPr({event,repository:repo,fetchImpl:f.fetchImpl});
 assert.equal(x.realGithubPrObserved,true);
 assert.equal(x.prReuseCandidate,true);
 assert.equal(x.linkedIssue,1865);
 assert.equal(x.branch,"sandbox-branch");
 assert.equal(x.ai09Status,"NO_CURRENT_HEAD_RECEIPT");
 assert.equal(x.ai09IsFormalApproval,false);
 assert.equal(x.autoFixPerformed,false);
 assert.equal(x.autoMergeAuthorized,false);
 assert.equal(f.seen.length,2);
 assert.ok(f.seen.every(y=>y.options.method==="GET" && !("Authorization" in y.options.headers)));
});
test("exact-head github-actions AI09 receipt remains advisory, not formal GitHub approval",async()=>{
 const f=fakeFetch({comments:[bot]});
 const r=await auditRealPr({event,repository:repo,fetchImpl:f.fetchImpl});
 assert.equal(r.ai09Status,"INCONCLUSIVE");
 assert.equal(r.ai09IsFormalApproval,false);
});
test("stale AI09 receipt cannot be treated as reviewed current head",async()=>{
 const f=fakeFetch({comments:[{...bot,body:bot.body.replace(B,"c".repeat(40))}]});
 assert.equal((await auditRealPr({event,repository:repo,fetchImpl:f.fetchImpl})).ai09Status,"NO_CURRENT_HEAD_RECEIPT");
});
test("forged bot sender is not accepted as AI09",async()=>{
 const f=fakeFetch({comments:[{...bot,user:{login:"attacker"}}]});
 assert.equal((await auditRealPr({event,repository:repo,fetchImpl:f.fetchImpl})).ai09Status,"NO_CURRENT_HEAD_RECEIPT");
});
test("current PR head mismatch stops before loading review comments",async()=>{
 const f=fakeFetch({pr:{...pull,head:{...pull.head,sha:"c".repeat(40)}}});
 await assert.rejects(()=>auditRealPr({event,repository:repo,fetchImpl:f.fetchImpl}),/STALE_OR_MISMATCHED_CURRENT_PR/);
 assert.equal(f.seen.length,1);
});
test("cross-repository PR is rejected before network",async()=>{
 const f=fakeFetch();
 await assert.rejects(()=>auditRealPr({event:{...event,payload:{number:1866,pull_request:{
 ...pull,head:{...pull.head,repo:{full_name:"attacker/fork"}}}}},repository:repo,fetchImpl:f.fetchImpl}),/PR_CONTEXT_NOT_VERIFIED/);
 assert.equal(f.seen.length,0);
});
test("full comments page fails closed rather than claiming no current AI09",async()=>{
 const f=fakeFetch({comments:Array.from({length:100},()=>({user:{login:"nobody"},body:"comment"}))});
 assert.equal((await auditRealPr({event,repository:repo,fetchImpl:f.fetchImpl})).ai09Status,"INCOMPLETE_COMMENT_INVENTORY");
});
test("GitHub API read failure is an error, never simulated success",async()=>{
 await assert.rejects(()=>auditRealPr({event,repository:repo,fetchImpl:async()=>({ok:false,status:403})}),
  /PUBLIC_GITHUB_READ_FAILED_403/);
});
test("multiple AI09 receipts need independent reconciliation",async()=>{
 const f=fakeFetch({comments:[bot,bot]});
 assert.equal((await auditRealPr({event,repository:repo,fetchImpl:f.fetchImpl})).ai09Status,
   "MULTIPLE_RECEIPTS_REQUIRES_RECONCILIATION");
});

test("unlinked PR is observed but not misreported as a reuse candidate",async()=>{
 const f=fakeFetch({pr:{...pull,body:"Unrelated work"}});
 const r=await auditRealPr({event,repository:repo,fetchImpl:f.fetchImpl});
 assert.equal(r.realGithubPrObserved,true);
 assert.equal(r.prReuseCandidate,false);
 assert.equal(r.linkedIssue,null);
});
