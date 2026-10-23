import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { preflightPublisher, ownerApprovalForPublisher } from "../scripts/chat-actions-publisher-preflight.mjs";

const REPO="haji84/AI-", SHA="a".repeat(40), BASE="b".repeat(40);
const MAIN="e".repeat(40), NOW=Date.parse("2026-10-24T10:00:00Z");
const approval={user:{login:"haji84"},author_association:"OWNER",
 created_at:"2026-10-24T09:00:00Z",
 body:"AUTHORIZE_GORIQ_TRUSTED_PUBLISHER_1865 main="+MAIN+" expiry=2026-10-26T10:00:00Z"};
const path="tests/fixtures/chat-actions-model-candidate.mjs";
const broken="export function add(a, b) { return a - b; }\n";
const fixed="export function add(a, b) { return a + b; }\n";
const event={repository:{full_name:REPO},workflow_run:{
  id:21,name:"Chat Actions Isolated Smoke (Non-Production)",status:"completed",
  conclusion:"success",event:"pull_request",
  head_sha:SHA,head_branch:"codex/1865-pr-reuse-advisory",
  head_repository:{full_name:REPO},
  pull_requests:[{number:1866,head:{sha:SHA}}],
}};
const pr={number:1866,state:"open",draft:true,body:"Refs #1865",
  head:{sha:SHA,ref:"codex/1865-pr-reuse-advisory",repo:{full_name:REPO}},
  base:{sha:BASE,ref:"main",repo:{full_name:REPO}}};
function stub({content=broken,artifacts=[{name:"chat-actions-real-model-candidate",id:123,expired:false}],approvals=[approval]}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options?.method});
  if(url.endsWith("/pulls/1866"))return {ok:true,json:async()=>pr};
  if(url.includes("/contents/"+path+"?ref="+SHA))
    return {ok:true,json:async()=>({encoding:"base64",content:Buffer.from(content).toString("base64"),sha:"c".repeat(40)})};
  if(url.includes("/issues/1865/comments?per_page=100"))
    return {ok:true,json:async()=>approvals};
  if(url.includes("/actions/runs/21/artifacts?per_page=100"))
    return {ok:true,json:async()=>({total_count:artifacts.length,artifacts})};
  throw Error("UNEXPECTED_"+url);
 };
 return {calls,fetchImpl};
}
test("eligible only after exact matching PR and one authentic run artifact",async()=>{
 const s=stub();const r=await preflightPublisher({event,token:"test-token",trustedMainSha:MAIN,now:NOW,fetchImpl:s.fetchImpl});
 assert.equal(r.eligible,true);assert.equal(r.artifactId,123);
 assert.equal(s.calls.length,4);assert.ok(s.calls.every(x=>x.method==="GET"));
});
test("already repaired PR does not require artifact lookup or another write",async()=>{
 const s=stub({content:fixed});const r=await preflightPublisher({event,token:"test-token",trustedMainSha:MAIN,now:NOW,fetchImpl:s.fetchImpl});
 assert.equal(r.eligible,false);assert.equal(r.reason,"ALREADY_FIXED");assert.equal(s.calls.length,2);
});
test("missing artifact is not eligible and cannot run publisher",async()=>{
 const s=stub({artifacts:[]});const r=await preflightPublisher({event,token:"test-token",trustedMainSha:MAIN,now:NOW,fetchImpl:s.fetchImpl});
 assert.equal(r.eligible,false);assert.equal(r.reason,"NO_REAL_MODEL_CANDIDATE");
});
test("two identical artifacts cause hold instead of picking one",async()=>{
 const s=stub({artifacts:[{name:"chat-actions-real-model-candidate",id:11},
  {name:"chat-actions-real-model-candidate",id:22}]});
 await assert.rejects(()=>preflightPublisher({event,token:"test-token",trustedMainSha:MAIN,now:NOW,fetchImpl:s.fetchImpl}),
 /AMBIGUOUS_CANDIDATE_ARTIFACT/);
});
test("missing or forged run identity is rejected before any network",async()=>{
 const s=stub();
 await assert.rejects(()=>preflightPublisher({event:{...event,workflow_run:{...event.workflow_run,
   conclusion:"failure"}},token:"test-token",trustedMainSha:MAIN,now:NOW,fetchImpl:s.fetchImpl}),/UNTRUSTED_PILOT_RUN/);
 assert.equal(s.calls.length,0);
});

test("missing owner Human Gate approval prevents a privileged publication",async()=>{
 const s=stub({approvals:[]});
 const r=await preflightPublisher({event,token:"test-token",trustedMainSha:MAIN,now:NOW,fetchImpl:s.fetchImpl});
 assert.equal(r.eligible,false);assert.equal(r.reason,"OWNER_ACTIVATION_APPROVAL_REQUIRED");
 assert.equal(s.calls.length,3);
});
test("approval is bound to authenticated owner, exact trusted main and expiry",()=>{
 assert.equal(ownerApprovalForPublisher([approval],{trustedMainSha:MAIN,now:NOW}),true);
 assert.equal(ownerApprovalForPublisher([{...approval,user:{login:"ai-bot"}}],{trustedMainSha:MAIN,now:NOW}),false);
 assert.equal(ownerApprovalForPublisher([{...approval,author_association:"CONTRIBUTOR"}],{trustedMainSha:MAIN,now:NOW}),false);
 assert.equal(ownerApprovalForPublisher([approval],{trustedMainSha:"f".repeat(40),now:NOW}),false);
 assert.equal(ownerApprovalForPublisher([approval],{trustedMainSha:MAIN,
   now:Date.parse("2026-10-27T00:00:00Z")}),false);
});
test("incomplete approval comment inventory cannot authorize publisher",()=>{
 assert.equal(ownerApprovalForPublisher(Array.from({length:100},()=>approval),
   {trustedMainSha:MAIN,now:NOW}),false);
});
