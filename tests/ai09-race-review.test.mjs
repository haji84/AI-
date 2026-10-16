import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {reviewRacePull,parseRaceRequest,safeRaceFindingSummaries,assessFindingAnchors} from "../scripts/goriq-ai09-race-review.mjs";

const A="a".repeat(40),B="b".repeat(40),REPO="haji84/RACE-AI";
const pr={number:65,state:"open",head:{sha:B,repo:{id:31,full_name:REPO}},
 base:{sha:A,repo:{id:31,full_name:REPO}}};
const checks=["unit (ubuntu-latest)","unit (windows-latest)","pilot"].map((name,i)=>
  ({id:i+1,name,head_sha:B,app:{slug:"github-actions"},status:"completed",conclusion:"success"}));
const compare={status:"ahead",ahead_by:1,total_commits:1,
  base_commit:{sha:A},commits:[{sha:B}],
  files:[{filename:"src/example.mjs",patch:"@@ -0,0 +1,1 @@\n+export const answer=42;",
    additions:1,deletions:0}]};
const good=JSON.stringify({verdict:"NO_FINDINGS",findings:[]});
const bad=JSON.stringify({verdict:"CHANGES_REQUESTED",
 findings:[{path:"src/example.mjs",line:1,severity:"low",summary:"Review example",evidence:"Added `export const answer=42;`",proposedFix:"Verify feature"}]});
const api=(opts={})=>async path=>{
 if(path==="/pulls/65")return opts.pr??pr;
 if(path.includes("/check-runs"))return {total_count:(opts.checks??checks).length,
   check_runs:opts.checks??checks};
 if(path.includes("/compare/"))return opts.compare??compare;
 throw Error("unexpected API route");
};
const req=(opts={})=>({number:65,head:B,base:A,api:api(opts),infer:async()=>good});
test("successful local-model contract is advisory only, never merge authority",async()=>{
 const result=await reviewRacePull(req());
 assert.equal(result.reviewer,"AI-09");
 assert.equal(result.status,"NO_ACTIONABLE_FINDINGS");
 assert.deepEqual(result.reviewedPaths,["src/example.mjs"]);
 assert.equal(result.githubApprovalSatisfied,false);
 assert.equal(result.physicalEvidenceVerified,false);
 assert.equal(result.mergeAuthorized,false);
});
test("independent Builder/Debugger correction is an unacknowledged handoff",async()=>{
 const result=await reviewRacePull({...req(),infer:async()=>bad});
 assert.equal(result.status,"CHANGES_REQUESTED");
 assert.equal(result.correctionHandoff.taskId,"ai09:race:65:"+B);
 assert.equal(result.correctionHandoff.actualTaskAcknowledged,false);
 assert.equal(result.correctionHandoff.allowedToWrite,false);
});
test("head or origin mutation refuses untrusted input",async()=>{
 for(const edited of [
   {...pr,head:{...pr.head,sha:A}},
   {...pr,head:{...pr.head,repo:{id:99,full_name:"other/else"}}},
   {...pr,base:{...pr.base,sha:B}}
 ])await assert.rejects(reviewRacePull(req({pr:edited})),/RACE_PR_HEAD_OR_ORIGIN_CHANGED/);
});
test("failed, pending, missing or duplicate exact-head CI never runs the model",async()=>{
 for(const change of [
   checks.slice(1),
   [checks[0],checks[0],...checks.slice(1)],
   checks.map((x,i)=>i===0?{...x,status:"in_progress"}:x),
   checks.map((x,i)=>i===1?{...x,conclusion:"failure"}:x),
   checks.map((x,i)=>i===1?{...x,head_sha:A}:x)
 ]) {
   let invoked=0;
   await assert.rejects(reviewRacePull({...req({checks:change}),infer:async()=>{invoked++;return good;}}),/RACE_CI_NOT_VERIFIED/);
   assert.equal(invoked,0);
 }
});
test("incomplete PR patch is blocked before model inference",async()=>{
 let invoked=0;
 const truncated={...compare,files:[{...compare.files[0],additions:2}]};
 await assert.rejects(reviewRacePull({...req({compare:truncated}),infer:async()=>{invoked++;return good;}}),/incomplete_github_patch/);
 assert.equal(invoked,0);
});
test("invalid local model output cannot become a clean review",async()=>{
 const result=await reviewRacePull({...req(),infer:async()=>"{not json"});
 assert.equal(result.status,"BLOCKED");
 assert.equal(result.mergeAuthorized,false);
});
test("changed comparison SHA refuses model execution",async()=>{
 let invoked=0;
 await assert.rejects(reviewRacePull({...req({compare:{...compare,commits:[{sha:A}]}}),
   infer:async()=>{invoked++;return good;}}),/RACE_COMPARE_REVISION_CHANGED/);
 assert.equal(invoked,0);
});

test("RACE-issued bounded request manifest can be received only with exact scope",()=>{
 const manifest={
   schemaVersion:1,contract:"GORIQ_AI09_ADVISORY_REQUEST_V1",
   repository:REPO,prNumber:65,headSha:B,baseSha:A,
   recipient:"GORIQ/AI-09",ciReady:true,reviewerMustDifferFromBuilder:true,
   githubApprovalSatisfied:false,mergeAuthorized:false,gitHubWritePerformed:false,
   nextAction:"REQUEST_AI09"
 };
 const parsed=parseRaceRequest(["--manifest","fixture"],()=>manifest);
 assert.deepEqual(parsed,{number:65,head:B,base:A});
 // Request artifact is created before its own CI finishes. The receiver
 // MUST accept that pending receipt and independently verify live checks.
 const pending=parseRaceRequest(["--manifest","fixture"],()=>({
   ...manifest,ciReady:false,nextAction:"WAIT_FOR_EXACT_HEAD_CI"
 }));
 assert.deepEqual(pending,{number:65,head:B,base:A});
 assert.throws(()=>parseRaceRequest(["--manifest","fixture"],()=>({
   ...manifest,ciReady:false,nextAction:"REQUEST_AI09"
 })));
 for(const alteration of [
   {ciReady:false}, {mergeAuthorized:true}, {repository:"evil/fork"},
   {nextAction:"HOLD_REVIEW"}, {headSha:A},{reviewerMustDifferFromBuilder:false},
   {gitHubWritePerformed:true}, {contract:"forged"}
 ])assert.throws(()=>parseRaceRequest(["--manifest","fixture"],()=>({...manifest,...alteration})));
 assert.throws(()=>parseRaceRequest(["--manifest","fixture"],()=>null));
});

test("review stdout contains only machine-readable JSON",()=>{
 const source=readFileSync("scripts/goriq-ai09-race-review.mjs","utf8");
 assert.match(source,/console\.error\("AI09_MODEL_OUTPUT_METRICS="/);
 assert.match(source,/process\.stdout\.write\(JSON\.stringify\(review/);
 assert.doesNotMatch(source,/console\.log\(/);
});



test("GitHub diff line and exact code quote are independently checked before handing off AI suggestions",()=>{
 const changed={status:"ahead",ahead_by:1,total_commits:1,
   files:[{filename:"src/example.mjs",patch:"@@ -0,0 +1,1 @@\n+const_superSecureFlagIsEnabled=true;",
     additions:1,deletions:0}]};
 const suggestion={path:"src/example.mjs",line:1,
   evidence:"const_superSecureFlagIsEnabled=true;",summary:"Risky change",
   proposedFix:"Inspect actual source",severity:"medium"};
 const check=assessFindingAnchors(changed,[suggestion])[0];
 assert.equal(check.status,"CODE_QUOTE_MATCHED");
 assert.equal(check.machineGrounded,true);
 assert.equal(check.issueConfirmed,false);
 assert.equal(assessFindingAnchors(changed,[{...suggestion,line:123}])[0].status,"INVALID_CHANGED_LINE");
 assert.equal(assessFindingAnchors(changed,[{...suggestion,evidence:"This could be malicious!"}])[0].status,"MISSING_CODE_QUOTE");
 assert.equal(assessFindingAnchors(changed,[{...suggestion,path:"../wrong-file"}])[0].status,"INVALID_PATH");
});
test("real AI-09 findings are safely printable only after all chunks finish",()=>{
 const r={
  schemaVersion:1,repository:REPO,reviewer:"AI-09",headSha:B,baseSha:A,
  evidenceClass:"AI_ASSERTED",githubApprovalSatisfied:false,mergeAuthorized:false,
  independentGitHubAccountVerified:false,
  reviewedPaths:["src/example.mjs"],chunkCount:2,
  chunkOutcomes:[{sequence:1,status:"CHANGES_REQUESTED"},{sequence:2,status:"NO_ACTIONABLE_FINDINGS"}],
  status:"CHANGES_REQUESTED",
  findingGrounding:[{path:"src/example.mjs",line:7,status:"MISSING_CODE_QUOTE",machineGrounded:false,issueConfirmed:false}],
  findings:[{path:"src/example.mjs",line:7,severity:"medium",
    summary:"Validate edge cases @all",evidence:"A value may be omitted",
    proposedFix:"Add an explicit bounds check and test"}]
 };
 const safe=safeRaceFindingSummaries(r);
 assert.equal(safe.length,1);
 assert.doesNotMatch(safe[0].summary,/@all/);
 assert.equal(safe[0].mergeAuthorized,false);
 assert.equal(safe[0].evidenceClass,"AI_ASSERTED");
 assert.equal(safe[0].machineGrounded,false);
 assert.equal(safe[0].issueConfirmed,false);
 for(const change of [
   {chunkCount:3}, {chunkOutcomes:r.chunkOutcomes.slice(0,1)},
   {chunkOutcomes:[{sequence:2,status:"CHANGES_REQUESTED"},r.chunkOutcomes[1]]},
   {githubApprovalSatisfied:true},
   {status:"BLOCKED"},
   {findings:[{...r.findings[0],path:"../../out-of-scope"}]}
 ]) assert.throws(()=>safeRaceFindingSummaries({...r,...change}));
 const secret=safeRaceFindingSummaries({...r,findings:[{
   ...r.findings[0],summary:["git","hub_pat_","12345678901234567890"].join("")
 }]});
 assert.equal(secret[0].summary,"[REDACTED_UNSAFE_AI09_TEXT]");
 const multiline=safeRaceFindingSummaries({...r,findings:[{
   ...r.findings[0],evidence:"hello\nworld"
 }]});
 assert.equal(multiline[0].evidence,"hello world");
});
