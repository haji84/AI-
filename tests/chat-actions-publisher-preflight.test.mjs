import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { preflightPublisher } from "../scripts/chat-actions-publisher-preflight.mjs";

const REPO="haji84/AI-", SHA="a".repeat(40), BASE="b".repeat(40);
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
function stub({content=broken,artifacts=[{name:"chat-actions-real-model-candidate",id:123,expired:false}]}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options?.method});
  if(url.endsWith("/pulls/1866"))return {ok:true,json:async()=>pr};
  if(url.includes("/contents/"+path+"?ref="+SHA))
    return {ok:true,json:async()=>({encoding:"base64",content:Buffer.from(content).toString("base64"),sha:"c".repeat(40)})};
  if(url.includes("/actions/runs/21/artifacts?per_page=100"))
    return {ok:true,json:async()=>({total_count:artifacts.length,artifacts})};
  throw Error("UNEXPECTED_"+url);
 };
 return {calls,fetchImpl};
}
test("eligible only after exact matching PR and one authentic run artifact",async()=>{
 const s=stub();const r=await preflightPublisher({event,token:"test-token",fetchImpl:s.fetchImpl});
 assert.equal(r.eligible,true);assert.equal(r.artifactId,123);
 assert.equal(s.calls.length,3);assert.ok(s.calls.every(x=>x.method==="GET"));
});
test("already repaired PR does not require artifact lookup or another write",async()=>{
 const s=stub({content:fixed});const r=await preflightPublisher({event,token:"test-token",fetchImpl:s.fetchImpl});
 assert.equal(r.eligible,false);assert.equal(r.reason,"ALREADY_FIXED");assert.equal(s.calls.length,2);
});
test("missing artifact is not eligible and cannot run publisher",async()=>{
 const s=stub({artifacts:[]});const r=await preflightPublisher({event,token:"test-token",fetchImpl:s.fetchImpl});
 assert.equal(r.eligible,false);assert.equal(r.reason,"NO_REAL_MODEL_CANDIDATE");
});
test("two identical artifacts cause hold instead of picking one",async()=>{
 const s=stub({artifacts:[{name:"chat-actions-real-model-candidate",id:11},
  {name:"chat-actions-real-model-candidate",id:22}]});
 await assert.rejects(()=>preflightPublisher({event,token:"test-token",fetchImpl:s.fetchImpl}),
 /AMBIGUOUS_CANDIDATE_ARTIFACT/);
});
test("missing or forged run identity is rejected before any network",async()=>{
 const s=stub();
 await assert.rejects(()=>preflightPublisher({event:{...event,workflow_run:{...event.workflow_run,
   conclusion:"failure"}},token:"test-token",fetchImpl:s.fetchImpl}),/UNTRUSTED_PILOT_RUN/);
 assert.equal(s.calls.length,0);
});
