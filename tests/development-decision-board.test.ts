import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildDevelopmentDecisionBoard } from "../src/orchestrator/development-decision-board.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";
import type { CompletionCycle, CompletionInput } from "../src/orchestrator/completion-path.ts";
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const HEAD="a".repeat(40), BASE="b".repeat(40);
function fixture() {
  const state: WorkState = {goalId:"goal-one",objective:"Evidence-bound development",
    definitionOfDone:[{id:"a",description:"verified A"},{id:"b",description:"verified B"}],
    currentState:"prepared",status:"IN_PROGRESS",riskClass:"R1",constraints:[],
    decisions:[],artifacts:[],verificationResults:[],childWorkItems:[],blockers:[],
    updatedAt:"2026-10-24T00:00:00.000Z"};
  const input={goalId:"goal-one",cycleId:"cycle-1",candidates:[
    {workItem:{id:"one"}},{workItem:{id:"two"}},{workItem:{id:"human"}},
  ]} as CompletionInput;
  const cycle={executionAuthority:false,cycleId:"cycle-1",stateDigest:hash(state),inputDigest:hash(input),
    remainingCriteria:["a","b"],gaps:["missing_evidence_contract:b"],blockers:[],
    candidates:[{taskId:"one",status:"READY",score:2,reasons:[]},
      {taskId:"two",status:"READY",score:1,reasons:[]},
      {taskId:"human",status:"HUMAN_REQUIRED",score:9,reasons:["permissionChange"]}],
    recommendation:{taskId:"one",mode:"ASSESS_FOR_EXECUTION",reuse:{pr:"1866"}},
    notifications:[{taskId:"human",kind:"approval",operation:"Authorize publisher",target:"publisher",status:"PREPARED",reason:"permissionChange"}],
    readyForCompletionReview:false} as unknown as CompletionCycle;
  return {state,input,cycle,options:{maxParallelJobs:2,verifiedResourceLocks:{one:["pr:1866"],two:["pr:1866"]}}};
}

test("five answers stay non-authoritative and missing requirements remain visible",()=>{
  const f=fixture();const result=buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,f.options);
  assert.deepEqual(result.missingFromGoal,["a","b"]);
  assert.deepEqual(result.parallel.proposals,["one"]);
  assert.equal(result.next?.taskId,"one");
  assert.equal(result.humanActions[0]?.status,"PREPARED");
  assert.equal(result.completion,"REQUIREMENTS_OPEN");
  assert.equal(result.executionAuthority,false);assert.equal(result.mergeAuthorized,false);assert.equal(result.goalAchieved,false);
});
test("separate verified resource locks allow safe parallel candidates",()=>{
  const f=fixture();f.options.verifiedResourceLocks.two=["pr:other"];
  assert.deepEqual(buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,f.options).parallel.proposals,["one","two"]);
});
test("missing resource inventory excludes task rather than inventing independence",()=>{
  const f=fixture();delete (f.options.verifiedResourceLocks as Record<string,string[]|undefined>).one;
  const r=buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,f.options);
  assert.deepEqual(r.parallel.proposals,["two"]);assert.deepEqual(r.parallel.resourceLockEvidenceMissing,["one"]);
});
test("stale state and changed input are rejected",()=>{
  const f=fixture();f.state.goalId="wrong";
  assert.throws(()=>buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,f.options),/STALE_OR_UNTRUSTED/);
  const g=fixture();g.input.cycleId="other";
  assert.throws(()=>buildDevelopmentDecisionBoard(g.state,g.input,g.cycle,g.options),/STALE_OR_UNTRUSTED/);
});
test("human gates never become ready from an unverified response",()=>{
  const f=fixture();f.cycle.notifications[0].status="ANSWERED";
  f.cycle.notifications[0].response={status:"denied"} as CompletionCycle["notifications"][number]["response"];
  const r=buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,f.options);
  assert.equal(r.humanActions[0]?.response,"denied");assert.equal(r.gatedTasks[0]?.status,"HUMAN_REQUIRED");
});
test("AI09 only becomes source-covered advisory on exact-head full evidence",()=>{
  const f=fixture();
  const evidence={expectedBaseSha:BASE,expectedHeadSha:HEAD,receiptBaseSha:BASE,receiptHeadSha:HEAD,
    expectedBatchCount:13,reviewedBatchCount:13,missingBatchIndexes:[],invalidReceiptCount:0,pendingIndependentVerification:0,acceptedReview:true};
  assert.equal(buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,{...f.options,ai09:evidence}).ai09,"SOURCE_COVERED_ADVISORY_ONLY");
  assert.equal(buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,{...f.options,ai09:{...evidence,receiptHeadSha:BASE}}).ai09,"STALE_OR_INVALID");
  assert.equal(buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,{...f.options,ai09:{...evidence,missingBatchIndexes:[2]}}).ai09,"HOLD");
});
test("all criteria ready still requires independent acceptance rather than auto declaring completion",()=>{
  const f=fixture();f.cycle.readyForCompletionReview=true;f.cycle.remainingCriteria=[];
  const r=buildDevelopmentDecisionBoard(f.state,f.input,f.cycle,f.options);
  assert.equal(r.completion,"INDEPENDENT_ACCEPTANCE_REQUIRED");assert.equal(r.goalAchieved,false);
});
