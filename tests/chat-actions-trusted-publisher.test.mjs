import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ownerApprovalForPublisher } from "../scripts/chat-actions-publisher-preflight.mjs";
import { verifyPilotRun, verifyPilotArtifact, preparePublication,
  buildCompareAndSwapMutation, publishTrustedPilot } from "../scripts/chat-actions-trusted-publisher.mjs";

const REPO="haji84/AI-";
const HEAD="a".repeat(40),BASE="b".repeat(40),COMMIT="c".repeat(40);
const BROKEN="export function add(a, b) { return a - b; }\n";
const FIXED="export function add(a, b) { return a + b; }\n";
const hash=s=>createHash("sha256").update(s).digest("hex");
const pr={
 number:1866,state:"open",draft:true,body:"Refs #1865. Same-PR review",
 head:{sha:HEAD,ref:"codex/1865-pr-reuse-advisory",repo:{full_name:REPO}},
 base:{sha:BASE,ref:"main",repo:{full_name:REPO}},
};
const event={repository:{full_name:REPO},workflow_run:{
 id:12345,event:"pull_request",name:"Chat Actions Isolated Smoke (Non-Production)",
 status:"completed",conclusion:"success",head_repository:{full_name:REPO},
 head_branch:"codex/1865-pr-reuse-advisory",head_sha:HEAD,
 pull_requests:[{number:1866,head:{sha:HEAD},base:{sha:BASE}}],
}};
const receipt={
 accepted:true,producer:"OLLAMA_REAL_MODEL",model:"qwen2.5-coder:3b",
 authority:"CANDIDATE_ONLY_NO_REMOTE_WRITE",
 path:"tests/fixtures/chat-actions-model-candidate.mjs",
 issue:1865,pr:1866,headSha:HEAD,beforeHash:hash(BROKEN),afterHash:hash(FIXED),
};
const plan=()=>preparePublication({event,pr,receipt,source:FIXED,currentFile:BROKEN});
function fakeGitHub(currentFile=BROKEN) {
 const seen=[];
 const fetchImpl=async(url,options)=>{
   seen.push({url,options});
   if(url==="https://api.github.com/repos/haji84/AI-/pulls/1866")
     return {ok:true,json:async()=>pr};
   if(url.startsWith("https://api.github.com/repos/haji84/AI-/contents/tests/fixtures/chat-actions-model-candidate.mjs?ref="))
     return {ok:true,json:async()=>({encoding:"base64",content:Buffer.from(currentFile).toString("base64"),
       sha:"d".repeat(40)})};
   if(url==="https://api.github.com/graphql")
     return {ok:true,json:async()=>({data:{createCommitOnBranch:{commit:{oid:COMMIT}}}})};
   throw Error("UNEXPECTED_ENDPOINT");
 };
 return {seen,fetchImpl};
}
test("accepts a precisely scoped successful original GitHub Actions event",()=>{
 assert.deepEqual(verifyPilotRun(event),{runId:12345,headSha:HEAD,prNumber:1866});
});
test("forged workflow / fork / wrong PR / failed run are rejected",()=>{
 for(const workflow_run of [
  {...event.workflow_run,name:"Unknown"},
  {...event.workflow_run,head_repository:{full_name:"attacker/repo"}},
  {...event.workflow_run,pull_requests:[{number:1867,head:{sha:HEAD}}]},
  {...event.workflow_run,conclusion:"failure"},
  {...event.workflow_run,head_sha:"x".repeat(40)}
 ])assert.throws(()=>verifyPilotRun({...event,workflow_run}),/UNTRUSTED_PILOT_RUN/);
});
test("model receipt is tied to exact pre/post content hashes and one file",()=>{
 assert.equal(verifyPilotArtifact(receipt,FIXED,{headSha:HEAD}).path,receipt.path);
 for(const wrong of [
  {...receipt,path:"AGENTS.md"}, {...receipt,pr:1867}, {...receipt,model:"codex"},
  {...receipt,beforeHash:hash("other")}, {...receipt,headSha:COMMIT}
 ])assert.throws(()=>verifyPilotArtifact(wrong,FIXED,{headSha:HEAD}),/MODEL_ARTIFACT_OUT_OF_SCOPE/);
});
test("malicious generator artifact cannot inject JavaScript or arbitrary destination",()=>{
 assert.throws(()=>verifyPilotArtifact(receipt,FIXED+"process.exit(1)\n",{headSha:HEAD}),/MODEL_ARTIFACT_OUT_OF_SCOPE/);
});
test("only exact current PR head allows valid publishing candidate",()=>{
 assert.equal(plan().action,"CANDIDATE_VALIDATED");
 assert.throws(()=>preparePublication({event,pr:{...pr,head:{...pr.head,sha:COMMIT}},
   receipt,source:FIXED,currentFile:BROKEN}),/PR_HEAD_CHANGED_OR_SCOPE_MISMATCH/);
 assert.throws(()=>preparePublication({event,pr:{...pr,draft:false},
   receipt,source:FIXED,currentFile:BROKEN}),/PR_HEAD_CHANGED_OR_SCOPE_MISMATCH/);
});
test("already repaired branch requires no second commit",()=>{
 assert.equal(preparePublication({event,pr,receipt,source:FIXED,currentFile:FIXED}).action,"NOOP_ALREADY_FIXED");
});
test("unexpected file changes fail closed",()=>{
 assert.throws(()=>preparePublication({event,pr,receipt,source:FIXED,currentFile:"unexpected"}),
  /FIXTURE_BASELINE_MISMATCH/);
});
test("GraphQL commit contains exact expectedHeadOid and only one allowlisted file",()=>{
 const mutation=buildCompareAndSwapMutation(plan());
 assert.equal(mutation.variables.input.expectedHeadOid,HEAD);
 assert.equal(mutation.variables.input.branch.branchName,pr.head.ref);
 assert.equal(mutation.variables.input.fileChanges.additions.length,1);
 const addition=mutation.variables.input.fileChanges.additions[0];
 assert.equal(addition.path,receipt.path);
 assert.equal(Buffer.from(addition.contents,"base64").toString("utf8"),FIXED);
});
test("dry run verifies real source via read-only GitHub and never sends GraphQL",async()=>{
 const api=fakeGitHub();
 const result=await publishTrustedPilot({fetchImpl:api.fetchImpl,token:"test-token",
   event,receipt,source:FIXED,dryRun:true});
 assert.equal(result.status,"VALIDATED_DRY_RUN");
 assert.equal(api.seen.length,2);
 assert.ok(api.seen.every(x=>x.options.method==="GET"));
});
test("authorized publisher uses one CAS GraphQL operation, never create PR or direct main update",async()=>{
 const api=fakeGitHub();
 const result=await publishTrustedPilot({fetchImpl:api.fetchImpl,token:"test-token",
   event,receipt,source:FIXED,dryRun:false});
 assert.equal(result.status,"PUBLISHED");
 assert.equal(result.commit,COMMIT);
 assert.equal(api.seen.length,3);
 const write=api.seen[2];
 assert.equal(write.url,"https://api.github.com/graphql");
 assert.equal(write.options.method,"POST");
 const mutation=JSON.parse(write.options.body);
 assert.equal(mutation.variables.input.expectedHeadOid,HEAD);
 assert.equal(mutation.variables.input.branch.branchName,"codex/1865-pr-reuse-advisory");
});
test("read-only preflight returns ALREADY_FIXED when remote candidate equals generated code",async()=>{
 const api=fakeGitHub(FIXED);
 const result=await publishTrustedPilot({fetchImpl:api.fetchImpl,token:"test-token",
   event,receipt,source:FIXED,dryRun:false});
 assert.equal(result.status,"ALREADY_FIXED");
 assert.equal(result.updated,false);
 assert.equal(api.seen.length,2);
});
test("GitHub GraphQL atomic-head rejection is not treated as successful push",async()=>{
 const api=fakeGitHub();
 const fetchImpl=async (url,options)=>{
  if(url==="https://api.github.com/graphql")return {ok:true,json:async()=>({
   errors:[{message:"expectedHeadOid does not match the branch head"}]})};
  return api.fetchImpl(url,options);
 };
 await assert.rejects(()=>publishTrustedPilot({fetchImpl,token:"test-token",event,receipt,source:FIXED,dryRun:false}),
  /GITHUB_CAS_REJECTED_OR_UNVERIFIED/);
});


test("independent reproduction: a forged arbitrary-file mutation cannot reach GitHub writes",async()=>{
 const api=fakeGitHub();
 const unsafe="export function add(a, b) { return a + b; }\n"+"// extra untrusted code\n";
 const malicious={
  ...receipt,path:".github/workflows/critical.yml",afterHash:hash(unsafe),
 };
 await assert.rejects(()=>publishTrustedPilot({
  fetchImpl:api.fetchImpl,token:"test-token",event,
  receipt:malicious,source:unsafe,dryRun:false,
 }),/MODEL_ARTIFACT_OUT_OF_SCOPE/);
 assert.equal(api.seen.length,2);
 assert.ok(api.seen.every(x=>x.options.method==="GET"));
});

test("independent reproduction: model cannot add arbitrary fileChanges by mutating the plan",()=>{
 const legitimate=plan();
 for(const untrusted of [
  {...legitimate,path:"AGENTS.md"},
  {...legitimate,source:FIXED+"// malicious"},
  {...legitimate,branch:"main"},
  {...legitimate,pr:1867},
  {...legitimate,fileChanges:{additions:[{path:"AGENTS.md",contents:"abc"}]}},
 ]) {
  if(untrusted.fileChanges){
   const mutation=buildCompareAndSwapMutation(untrusted);
   assert.deepEqual(mutation.variables.input.fileChanges.additions,
    [{path:"tests/fixtures/chat-actions-model-candidate.mjs",contents:Buffer.from(FIXED).toString("base64")}]);
  }else assert.throws(()=>buildCompareAndSwapMutation(untrusted),/INVALID_PUBLISH_PLAN/);
 }
});

test("independent reproduction: stale PR head prevents all write requests, even in publish mode",async()=>{
 const api=fakeGitHub();
 const fetchImpl=async (url,options)=>{
  if(url==="https://api.github.com/repos/haji84/AI-/pulls/1866"){
   api.seen.push({url,options});
   return {ok:true,json:async()=>({...pr,head:{...pr.head,sha:COMMIT}})};
  }
  return api.fetchImpl(url,options);
 };
 await assert.rejects(()=>publishTrustedPilot({fetchImpl,token:"test-token",event,
  receipt,source:FIXED,dryRun:false}),/PR_HEAD_CHANGED_OR_SCOPE_MISMATCH/);
 assert.ok(api.seen.every(x=>x.options.method==="GET"));
 assert.ok(!api.seen.some(x=>x.url==="https://api.github.com/graphql"));
});

test("independent reproduction: review status cannot be used as a substitute for owner authorization",()=>{
 // Any approval inferred from AI09 does not alter the write plan or grant
 // rights. The publisher still requires independent trusted preflight.
 assert.equal(ownerApprovalForPublisher([],{trustedMainSha:HEAD}),false);
 assert.equal(ownerApprovalForPublisher([
   {user:{login:"github-actions[bot]"},author_association:"NONE",
    body:"AI09 NO_ACTIONABLE_FINDINGS",created_at:"2026-10-24T00:00:00Z"}
 ],{trustedMainSha:HEAD}),false);
 const candidate={...plan(),approved:true,ai09Status:"NO_ACTIONABLE_FINDINGS"};
 const mutation=buildCompareAndSwapMutation(candidate);
 assert.equal(mutation.variables.input.expectedHeadOid,HEAD);
 assert.equal(mutation.variables.input.branch.branchName,"codex/1865-pr-reuse-advisory");
 assert.equal(mutation.variables.input.fileChanges.additions.length,1);
 assert.equal(Object.hasOwn(mutation.variables.input,"permissions"),false);
});
