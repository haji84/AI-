import assert from "node:assert/strict";
import test from "node:test";
import { adviseDevelopmentIntake, adviseChatActionsHandoff, type Intake, type ChatActionsHandoffInput } from "../src/orchestrator/development-pr-advisory.ts";

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

test("same-issue PR on another base cannot become a new PR candidate",()=>{
  for (const operation of ["new_work","fix_existing_pr"] as const) {
    const r=decide({operation,pullRequests:[{...existing,baseBranch:"release/1"}]});
    assert.equal(r.pr.action,"RECONCILE");
    assert.equal(r.pr.number,undefined);
    assert.equal(r.executionAuthority,false);
  }
});

test("same-issue PRs across different bases require reconciliation",()=>{
  const r=decide({pullRequests:[existing,{...existing,number:43,baseBranch:"release/1"}]});
  assert.equal(r.pr.action,"RECONCILE");
  assert.equal(r.pr.number,undefined);
});

test("closed same-issue history on another base still prevents replacement",()=>{
  const r=decide({operation:"new_work",pullRequests:[{...existing,baseBranch:"release/1",state:"closed"}]});
  assert.equal(r.pr.action,"RECONCILE");
});

test("closed other-base history must be reconciled before reusing an open PR",()=>{
  const r=decide({pullRequests:[existing,{...existing,number:43,baseBranch:"release/1",state:"closed"}]});
  assert.equal(r.pr.action,"RECONCILE");
});

test("other issues and repositories do not block a unique same-issue PR",()=>{
  const unrelated=[{...existing,number:43,issueNumber:6,baseBranch:"release/1"},
    {...existing,repository:"other/app",baseBranch:"release/1"}];
  assert.equal(decide({pullRequests:[existing,...unrelated]}).pr.number,42);
  assert.equal(decide({operation:"new_work",pullRequests:unrelated}).pr.action,"NEW_CANDIDATE");
});
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

const chatInput: ChatActionsHandoffInput = {
  source:"chat", command:"Implement existing requirement", goalId:"goal-681", messageId:"msg-1865",
  ownerIdentityVerifiedByTrustedHost:true, githubActionsAvailable:true,
  existingNonCodexBuilderAvailable:true,
};

test("different-base same-issue PR blocks Chat handoff without a command envelope",()=>{
  const r=adviseChatActionsHandoff(chatInput,decide({operation:"new_work",
    pullRequests:[{...existing,baseBranch:"release/1"}]}));
  assert.equal(r.status,"RECONCILE_PR");
  assert.equal(r.commandJson,null);
  assert.equal(r.codex,"NOT_SELECTED");
  assert.equal(r.executionAuthority,false);
});
test("Chat input proposes existing GitHub Actions envelope without dispatch authority",()=>{
  const r=adviseChatActionsHandoff(chatInput,decide());
  assert.equal(r.status,"PROPOSE_ONLY");
  assert.equal(r.workflow,"Mobile Autonomy");
  assert.equal(r.codex,"NOT_SELECTED");
  assert.deepEqual(JSON.parse(r.commandJson!),{source:"chat",command:chatInput.command,goalId:chatInput.goalId});
  assert.equal(r.executionAuthority,false);
});
test("unauthenticated Chat request never gets a dispatchable envelope",()=>{
  const r=adviseChatActionsHandoff({...chatInput,ownerIdentityVerifiedByTrustedHost:false},decide());
  assert.equal(r.status,"OWNER_PROOF_REQUIRED");assert.equal(r.commandJson,null);
});
test("human approval gate blocks Chat Actions dispatch, unrelated work can continue",()=>{
  const pr=decide({riskSignals:{permissionChange:true}});
  const r=adviseChatActionsHandoff(chatInput,pr);
  assert.equal(r.status,"APPROVAL_REQUIRED");assert.equal(r.commandJson,null);
  assert.equal(pr.unrelatedSafeWorkMayContinue,true);
});
test("security policy weakening never becomes chat-command permission",()=>{
  const r=adviseChatActionsHandoff(chatInput,decide({riskSignals:{humanGatePolicyRelaxation:true}}));
  assert.equal(r.status,"SECURITY_HOLD");assert.equal(r.commandJson,null);
});
test("PR collision blocks proposed Chat Actions dispatch",()=>{
  const r=adviseChatActionsHandoff(chatInput,decide({pullRequests:[existing,{...existing,number:54}]}));
  assert.equal(r.status,"RECONCILE_PR");
});
test("Codex is not default when no other builder is available",()=>{
  const r=adviseChatActionsHandoff({...chatInput,existingNonCodexBuilderAvailable:false},decide());
  assert.equal(r.status,"CAPABILITY_UNAVAILABLE");assert.equal(r.codex,"NOT_SELECTED");
});
test("Codex exception needs failed alternatives, evidence and existing authorization",()=>{
  const fallback={exhaustedAlternatives:["existing-actions-builder"],necessityEvidenceRef:"issue:1865/receipt",
    existingCodexAuthorizationVerified:true};
  const r=adviseChatActionsHandoff({...chatInput,existingNonCodexBuilderAvailable:false,
    codexFallback:fallback},decide());
  assert.equal(r.status,"CAPABILITY_UNAVAILABLE");assert.equal(r.codex,"EXCEPTION_CANDIDATE");
  assert.equal(r.commandJson,null);
  assert.equal(adviseChatActionsHandoff({...chatInput,existingNonCodexBuilderAvailable:false,
    codexFallback:{...fallback,existingCodexAuthorizationVerified:false}},decide()).codex,"NOT_SELECTED");
});
test("unavailable Actions host remains blocked without falling into Codex",()=>{
  const r=adviseChatActionsHandoff({...chatInput,githubActionsAvailable:false},decide());
  assert.equal(r.status,"ACTIONS_UNAVAILABLE");assert.equal(r.codex,"NOT_SELECTED");
});

test("global pause blocks Chat Actions handoff regardless of PR eligibility",()=>{
  const r=adviseChatActionsHandoff(chatInput,decide({globallyPaused:true}));
  assert.equal(r.status,"PAUSED");
  assert.equal(r.commandJson,null);
});

test("GitHub repository case differences reuse the same issue PR",()=>{
  const r=decide({pullRequests:[{...existing,repository:"SAMPLE/App"}]});
  assert.equal(r.pr.action,"REUSE");assert.equal(r.pr.number,42);
  assert.equal(r.executionAuthority,false);
});
test("mixed-case duplicate PR identities require reconciliation",()=>{
  assert.equal(decide({pullRequests:[existing,{...existing,repository:"SAMPLE/App"}]}).pr.action,"RECONCILE");
});
const malformedIntakes: [string,unknown][] = [
  ["array risk signals",{riskSignals:[]}],
  ["non-record risk signals",{riskSignals:new Date(0)}],
  ["array repository",{repository:["sample/app"]}],
  ["array base branch",{baseBranch:["main"]}],
  ["numeric base branch",{baseBranch:1}],
  ["blank base branch",{baseBranch:" "}],
  ["null inventory entry",{pullRequests:[null]}],
  ["sparse inventory",{pullRequests:Array(1)}],
  ["array inventory repository",{pullRequests:[{...existing,repository:["sample/app"]}]}],
  ["array inventory base",{pullRequests:[{...existing,baseBranch:["main"]}]}],
  ["array inventory head",{pullRequests:[{...existing,headBranch:["fix/five"]}]}],
];
for (const [name,changes] of malformedIntakes) {
  test(`${name} cannot produce a low-risk PR proposal`,()=>{
    assert.throws(()=>decide(changes as Partial<Intake>),/^Error: invalid_intake$/);
  });
}
test("array comparison SHA cannot impersonate a commit string",()=>{
  assert.throws(()=>decide({comparison:{baseSha:[A],headSha:B} as unknown as Intake["comparison"]}),/invalid_comparison/);
});
test("array receipt SHA cannot clear AI09 advisory",()=>{
  const r=decide({ai09:{reviewer:"AI-09",evidenceClass:"AI_ASSERTED",status:"NO_ACTIONABLE_FINDINGS",
    scope:{baseSha:[A],headSha:B},githubApprovalSatisfied:false,mergeAuthorized:false} as unknown as Intake["ai09"]});
  assert.equal(r.review,"INCONCLUSIVE");assert.equal(r.executionAuthority,false);
});
