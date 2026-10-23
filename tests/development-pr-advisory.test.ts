import assert from "node:assert/strict";
import test from "node:test";
import { adviseDevelopmentIntake, type Intake } from "../src/orchestrator/development-pr-advisory.ts";

const A="a".repeat(40), B="b".repeat(40), C="c".repeat(40);
const existing = { number:42, repository:"sample/app", issueNumber:5, baseBranch:"main",
  headBranch:"feature/five", state:"open" as const, merged:false };
const base: Intake = { repository:"sample/app", issueNumber:5, baseBranch:"main",
  operation:"fix_existing_pr", inventoryComplete:true, pullRequests:[existing],
  riskEvidenceComplete:true, riskSignals:{}, comparison:{baseSha:A,headSha:B}, globallyPaused:false };
const decide=(changes:Partial<Intake>={})=>adviseDevelopmentIntake({...base,...changes});

test("existing correction reuses same PR without authorizing writes",()=>{
  const r=decide(); assert.equal(r.pr.action,"REUSE");assert.equal(r.pr.number,42);assert.equal(r.executionAuthority,false);
});
test("head revision does not create a new PR",()=>assert.equal(
  decide({comparison:{baseSha:A,headSha:C}}).pr.number,42));
test("two open issue PRs require reconciliation",()=>assert.equal(
  decide({pullRequests:[existing,{...existing,number:43,headBranch:"other"}]}).pr.action,"RECONCILE"));
test("closed original cannot become a new correction PR",()=>assert.equal(
  decide({pullRequests:[{...existing,state:"closed"}]}).pr.action,"RECONCILE"));
test("incomplete GitHub inventory cannot propose PR creation",()=>assert.equal(
  decide({operation:"new_work",inventoryComplete:false,pullRequests:[]}).pr.action,"RECONCILE"));
test("genuine new issue work only proposes a new PR",()=>{
  const r=decide({operation:"new_work",pullRequests:[]});
  assert.equal(r.pr.action,"NEW_CANDIDATE");assert.equal(r.executionAuthority,false);
});
test("high-risk approval waits without global shutdown",()=>{
  const r=decide({riskSignals:{permissionChange:true}});
  assert.equal(r.gate,"HUMAN_REQUIRED");assert.equal(r.unrelatedSafeWorkMayContinue,true);
});
test("policy relaxation is not silently converted into ordinary approval",()=>assert.equal(
  decide({riskSignals:{humanGatePolicyRelaxation:true}}).gate,"SECURITY_HOLD"));
test("missing risk evidence is investigated and global pause respected",()=>{
  const r=decide({riskEvidenceComplete:false,globallyPaused:true});
  assert.equal(r.gate,"ASSESSMENT_REQUIRED");assert.equal(r.unrelatedSafeWorkMayContinue,false);
});
test("AI09 clear is advisory and not approval",()=>{
  const r=decide({ai09:{reviewer:"AI-09",evidenceClass:"AI_ASSERTED",status:"NO_ACTIONABLE_FINDINGS",
    scope:{baseSha:A,headSha:B},githubApprovalSatisfied:false,mergeAuthorized:false}});
  assert.equal(r.review,"CLEAR_ADVISORY");assert.equal(r.executionAuthority,false);
});
test("AI09 stale SHA cannot clear revised PR",()=>assert.equal(
  decide({ai09:{reviewer:"AI-09",evidenceClass:"AI_ASSERTED",status:"NO_ACTIONABLE_FINDINGS",
    scope:{baseSha:A,headSha:C},githubApprovalSatisfied:false,mergeAuthorized:false}}).review,"STALE"));
test("forged AI09 merge approval fails closed",()=>assert.equal(
  decide({ai09:{reviewer:"AI-09",evidenceClass:"AI_ASSERTED",status:"NO_ACTIONABLE_FINDINGS",
    scope:{baseSha:A,headSha:B},githubApprovalSatisfied:true,mergeAuthorized:true} as unknown as Intake["ai09"]}).review,"INCONCLUSIVE"));
test("unknown risk signal cannot be treated as low risk",()=>assert.throws(
  ()=>decide({riskSignals:{unreviewedCapability:true} as unknown as Intake["riskSignals"]}),/invalid_intake/));
