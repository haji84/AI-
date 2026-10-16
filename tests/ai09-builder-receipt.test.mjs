import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareVerifiedRepairProposal } from "../scripts/goriq-ai09-independent-triage.mjs";
import { verifyBuilderAcknowledgement } from "../scripts/goriq-ai09-builder-receipt.mjs";
const A="a".repeat(40),B="b".repeat(40),REPO="haji84/AI-";
const patch="diff --git a/src/check.mjs b/src/check.mjs\n@@ -0,0 +1 @@\n+console.log(request.headers.authorization);";
const sha=createHash("sha256").update(patch).digest("hex");
const finding={path:"src/check.mjs",line:1,severity:"high",
 evidence:"Code `console.log(request.headers.authorization);`",summary:"Check code",proposedFix:"Inspect"};
const request={repository:REPO,prNumber:73,
  review:{reviewer:"AI-09",evidenceClass:"AI_ASSERTED",
    status:"CHANGES_REQUESTED",githubApprovalSatisfied:false,mergeAuthorized:false,
    independentGitHubAccountVerified:false,
    scope:{headSha:B,baseSha:A,patchSha256:sha,paths:[finding.path]},
    findings:[finding]},trustedPatch:patch,findingIndex:0,
  verificationRef:"gh:review:123456"};
const proof=expected=>({...expected,authenticated:true,independent:true,reproduced:true,
  evidenceClass:"HUMAN_VERIFIED",evidenceId:"gh:review:123456",
  evidenceSha256:"e".repeat(64),verifierActor:"verifier-1",builderActor:"builder-1"});
const goalId="goal-ai09-repair-73";
async function candidate(){
  const r=await prepareVerifiedRepairProposal(request,async({expected})=>proof(expected));
  assert.equal(r.status,"VERIFIED_CANDIDATE");
  return r;
}
function setup(proposal){
  const item={id:proposal.handoff.TASK_ID,status:"IN_PROGRESS",
    affectedScope:[finding.path],objective:"Scoped reproduction and repair",
    definitionOfDone:[],executionApproach:"bounded",verificationMethod:"independent"};
  const state={goalId,childWorkItems:[item]};
  const receipt={taskId:item.id,goalId,workItemId:item.id,status:"ACKNOWLEDGED",
    issuer:"GORIQ_GOAL_CONTROLLER",builderRole:"Builder",
    headSha:B,baseSha:A,patchSha256:sha,
    verificationEvidenceId:"gh:review:123456",receiptId:"receipt-87654321",
    builderIdentity:"builder-1",acceptedAt:"2026-10-17T00:01:00Z"};
  return {state,receipt};
}
async function check(proposal,{state,receipt},override={}){
  return verifyBuilderAcknowledgement({goalId,proposal,
    workStateStore:{get:async()=>state},
    readAuthenticatedReceipt:async()=>receipt,...override});
}
test("trusted WorkState child and Builder receipt allow acknowledgment only",async()=>{
  const proposal=await candidate();
  const data=setup(proposal);
  const result=await check(proposal,data);
  assert.equal(result.status,"BUILDER_RECEIPT_MATCHED");
  assert.equal(result.taskId,proposal.handoff.TASK_ID);
  assert.equal(result.receiptId,"receipt-87654321");
  assert.equal(result.builderAcknowledged,true);
  assert.equal(result.taskPresentInAuthorityStore,true);
  assert.equal(result.writeAuthorized,false);
  assert.equal(result.githubApprovalSatisfied,false);
  assert.equal(result.mergeAuthorized,false);
});
test("AI suggestion alone, absent goal store or absent Builder cannot be accepted",async()=>{
  const proposal=await candidate();
  const data=setup(proposal);
  for(const params of [
    {workStateStore:null},
    {workStateStore:{get:async()=>null}},
    {readAuthenticatedReceipt:async()=>null},
    {workStateStore:{get:async()=>({...data.state,childWorkItems:[]})}},
    {workStateStore:{get:async()=>({...data.state,childWorkItems:[{...data.state.childWorkItems[0],status:"NOT_STARTED"}]})}},
  ]){
    const result=await check(proposal,data,params);
    assert.equal(result.builderAcknowledged,false);
    assert.equal(result.writeAuthorized,false);
  }
  const pending=await verifyBuilderAcknowledgement({goalId,proposal:{
    ...proposal,independentVerificationSatisfied:false},
    workStateStore:{get:async()=>data.state},
    readAuthenticatedReceipt:async()=>data.receipt});
  assert.equal(pending.status,"BUILDER_ACK_PENDING");
});
test("forged acknowledgement identity, state, source revision or scope never passes",async()=>{
  const proposal=await candidate();
  const data=setup(proposal);
  const changes=[
    {taskId:"ai09:pr:other"},{goalId:"goal-another"},
    {workItemId:"task-else"},{status:"PENDING"},
    {issuer:"AI-09"},{builderRole:"Reviewer"},
    {headSha:A},{baseSha:B},{patchSha256:"d".repeat(64)},
    {verificationEvidenceId:"gh:review:999999"},
    {receiptId:"not valid receipt"},{builderIdentity:"ai-09"},
    {acceptedAt:"invalid"},
  ];
  for(const change of changes){
    const result=await check(proposal,{...data,receipt:{...data.receipt,...change}});
    assert.equal(result.builderAcknowledged,false);
  }
});
test("duplicate task, stale status and widened files are rejected",async()=>{
  const proposal=await candidate();
  const data=setup(proposal);
  const item=data.state.childWorkItems[0];
  for(const children of [
    [item,item],
    [{...item,status:"COMPLETED"}],
    [{...item,affectedScope:[finding.path,"other.js"]}],
    [{...item,affectedScope:["src/other.js"]}],
  ]){
    const r=await check(proposal,{...data,state:{...data.state,childWorkItems:children}});
    assert.equal(r.status,"BUILDER_ACK_PENDING");
  }
});
