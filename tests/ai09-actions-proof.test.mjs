import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { createGitHubActionsFailureVerifier,createGitHubReadOnlyActionsClient } from "../scripts/goriq-ai09-actions-proof.mjs";
import { createGitHubHumanReproductionVerifier } from "../scripts/goriq-ai09-github-human-verifier.mjs";
import { prepareVerifiedRepairProposal } from "../scripts/goriq-ai09-independent-triage.mjs";

const A="a".repeat(40),B="b".repeat(40),REPO="haji84/AI-";
const expected={repository:REPO,prNumber:73,headSha:B,baseSha:A,
  patchSha256:"e".repeat(64),path:"src/repro.mjs",line:1,findingIndex:0};
const log=Buffer.from("2026-10-17 test failed: expected 1 got 0\n##[error]Process completed with exit code 1.\n","utf8");
const logHash=createHash("sha256").update(log).digest("hex");
const attestation={reproductionCaseRef:"gh:job:98765",reproductionSha256:logHash};
const run={id:456,head_sha:B,status:"completed",conclusion:"failure",event:"pull_request",
  name:"CI",repository:{id:31,full_name:REPO},
  pull_requests:[{number:73,head:{sha:B,repo:{id:31}},base:{sha:A,repo:{id:31}}}]};
const job={id:98765,run_id:456,head_sha:B,status:"completed",conclusion:"failure",name:"Test"};
function sources({ci=run,task=job,body=log}={}){
  const paths=[];
  return {
    paths,
    githubGet:async p=>{
      paths.push(p);
      if(p==="/actions/jobs/98765")return task;
      if(p==="/actions/runs/456")return ci;
      throw Error("unexpected route");
    },
    githubReadJobLog:async id=>{paths.push("log:"+id);return body;},
  };
}
async function result(input){
  const src=sources(input);
  const verifier=createGitHubActionsFailureVerifier({repository:REPO,...src});
  return {receipt:await verifier({expected,attestation}),paths:src.paths};
}
test("independent Actions proof retrieves job, run, actual raw log and checks full digest",async()=>{
  const data=await result({});
  assert.equal(data.receipt.verified,true);
  assert.equal(data.receipt.logSha256,logHash);
  assert.equal(data.receipt.conclusion,"failure");
  assert.equal(data.receipt.underlyingDefectVerified,false);
  assert.deepEqual(data.paths,["/actions/jobs/98765","/actions/runs/456","log:98765"]);
});
test("head/base/PR/repository mismatch or successful job is rejected before log download",async()=>{
  const scenarios=[
    {task:{...job,conclusion:"success"}},
    {task:{...job,head_sha:A}},
    {task:{...job,run_id:0}},
    {ci:{...run,head_sha:A}},
    {ci:{...run,event:"push"}},
    {ci:{...run,status:"in_progress"}},
    {ci:{...run,repository:{id:32,full_name:REPO}}},
    {ci:{...run,pull_requests:[{number:73,head:{sha:A,repo:{id:31}},base:{sha:A,repo:{id:31}}}]}},
    {ci:{...run,pull_requests:[]}},
  ];
  for(const scenario of scenarios){
    const s=sources(scenario);
    const verifier=createGitHubActionsFailureVerifier({repository:REPO,...s});
    await assert.rejects(verifier({expected,attestation}),/ACTIONS_EVIDENCE_UNAVAILABLE_OR_STALE/);
    assert.ok(!s.paths.some(v=>v.startsWith("log:")));
  }
});
test("missing, changed, padded or oversized raw log fails closed",async()=>{
  for(const body of ["",Buffer.from("altered result reported by a different test\n"),Buffer.alloc(2*1024*1024+1)]){
    const s=sources({body});
    const verifier=createGitHubActionsFailureVerifier({repository:REPO,...s});
    await assert.rejects(verifier({expected,attestation}),/UNREVIEWABLE_ACTIONS_LOG_SIZE|ACTIONS_LOG_SHA256_MISMATCH/);
  }
  const s=sources();
  const verifier=createGitHubActionsFailureVerifier({repository:REPO,...s});
  await assert.rejects(verifier({expected,attestation:{...attestation,reproductionSha256:"0".repeat(64)}}),
    /ACTIONS_LOG_SHA256_MISMATCH/);
});
test("raw log reference is exact, no model supplied arbitrary REST path",async()=>{
  const s=sources();
  const verifier=createGitHubActionsFailureVerifier({repository:REPO,...s});
  for(const unsafe of ["../98765","gh:job:0","gh:job:98765/other","gh:job:999999999999999999999"]){
    await assert.rejects(verifier({expected,attestation:{...attestation,reproductionCaseRef:unsafe}}),
      /INVALID_ACTIONS_EVIDENCE_SCOPE|INVALID_ACTIONS_JOB_ID/);
  }
  assert.equal(s.paths.length,0);
});
test("read-only client never sends token to signed GitHub log storage",async()=>{
  const calls=[];
  const redirect="https://results.githubusercontent.com/run123?sig=signed-url";
  const fetchImpl=async (url,init)=>{
    calls.push({url,init});
    if(url.endsWith("/logs"))return {status:302,headers:{get:()=>redirect}};
    if(url===redirect)return {
      status:200,headers:{get:()=>String(log.length)},
      body:{getReader:()=>{
        let sent=false;
        return {read:async()=>{
          if(sent)return {done:true};
          sent=true;
          return {done:false,value:new Uint8Array(log)};
        }};
      }},
    };
    return {status:200,json:async()=>url.endsWith("/jobs/98765")?job:run};
  };
  const client=createGitHubReadOnlyActionsClient({
    repository:REPO,token:"test_readonly_token",fetchImpl,
  });
  assert.equal((await client.githubGet("/actions/jobs/98765")).id,98765);
  assert.equal((await client.githubGet("/actions/runs/456")).id,456);
  assert.deepEqual(await client.githubReadJobLog(98765),log);
  assert.equal(calls.length,4);
  assert.equal(calls[0].init.method,"GET");
  assert.equal(calls[0].init.headers.Authorization,"Bearer test_readonly_token");
  assert.equal(calls[3].init.headers,undefined);
  assert.equal(calls[3].init.redirect,"manual");
});
test("read-only client denies unknown routes and untrusted log redirect",async()=>{
  let calls=0;
  const client=createGitHubReadOnlyActionsClient({
    repository:REPO,token:"test_readonly_token",
    fetchImpl:async()=>{calls++;return {
      status:302,headers:{get:()=> "https://evil.example/collect?token=sensitive"},
    };},
  });
  for(const path of ["/issues/73/comments","/actions/jobs/98765/logs?evil=1",
    "/actions/runs/456/dispatches","/actions/jobs/../98765"]){
    await assert.rejects(client.githubGet(path),/UNAUTHORIZED_ACTIONS_READ_PATH/);
  }
  assert.equal(calls,0);
  await assert.rejects(client.githubReadJobLog(98765),/UNTRUSTED_ACTIONS_LOG_REDIRECT/);
  assert.equal(calls,1);
});
test("a streamed log exceeding the byte cap is rejected without materializing it",async()=>{
  const signed="https://objects.githubusercontent.com/job-log?sig=test";
  const client=createGitHubReadOnlyActionsClient({
    repository:REPO,token:"test_readonly_token",
    fetchImpl:async(url)=>url.endsWith("/logs")
      ? {status:302,headers:{get:()=>signed}}
      : {status:200,headers:{get:()=>null},body:{getReader:()=>({
          read:async()=>({done:false,value:new Uint8Array(2*1024*1024+1)}),
          cancel:async()=>{},
        })}},
  });
  await assert.rejects(client.githubReadJobLog(98765),/UNREVIEWABLE_ACTIONS_LOG_SIZE/);
});
test("unsafe repository scope and empty credentials cannot construct live reader",()=>{
  for(const repository of ["haji84/..","../AI-","haji84/AI-/next"]){
    assert.throws(()=>createGitHubReadOnlyActionsClient({
      repository,token:"test_readonly_token",
    }),/INVALID_ACTIONS_READONLY_CLIENT_CONFIG/);
  }
  assert.throws(()=>createGitHubReadOnlyActionsClient({repository:REPO,token:""}),
    /INVALID_ACTIONS_READONLY_CLIENT_CONFIG/);
});

test("human review and raw Actions proof jointly gate a real-shaped triage proposal",async()=>{
  const patch="diff --git a/src/proof.mjs b/src/proof.mjs\n@@ -0,0 +1 @@\n+console.log(request.headers.authorization);";
  const patchSha256=createHash("sha256").update(patch).digest("hex");
  const scope={...expected,patchSha256,path:"src/proof.mjs"};
  const attested={schemaVersion:1,...scope,reproduced:true,
    reproductionCaseRef:"gh:job:98765",reproductionSha256:logHash};
  const review={
    id:112233,user:{login:"separate-reviewer",type:"User"},
    state:"COMMENTED",commit_id:B,submitted_at:"2026-10-17T00:30:00Z",
    body:"AI09_INDEPENDENT_REPRODUCTION_V1\n"+JSON.stringify(attested),
  };
  const getReview=async path=>{
    if(path==="/pulls/73")return {number:73,state:"open",
      user:{login:"different-author"},
      head:{sha:B,repo:{full_name:REPO}},
      base:{sha:A,repo:{full_name:REPO}}};
    if(path==="/pulls/73/reviews?per_page=100&page=1")return [review];
    throw Error("unexpected verified review read");
  };
  const evidenceSource=sources({ci:run,task:job,body:log});
  const verifyReproductionEvidence=createGitHubActionsFailureVerifier({
    repository:REPO,githubGet:evidenceSource.githubGet,
    githubReadJobLog:evidenceSource.githubReadJobLog,
  });
  const verifier=createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"builder-1",
    allowedReviewerLogins:["separate-reviewer"],
    githubGet:getReview,verifyReproductionEvidence,
  });
  const aiReview={reviewer:"AI-09",evidenceClass:"AI_ASSERTED",
    status:"CHANGES_REQUESTED",mergeAuthorized:false,
    githubApprovalSatisfied:false,independentGitHubAccountVerified:false,
    scope:{headSha:B,baseSha:A,patchSha256,paths:[scope.path]},
    findings:[{path:scope.path,line:1,
      evidence:"Added `console.log(request.headers.authorization);`",
      severity:"high",summary:"Needs independent reproduction",
      proposedFix:"Request triage"}]};
  const proposal=await prepareVerifiedRepairProposal({
    repository:REPO,prNumber:73,review:aiReview,
    trustedPatch:patch,findingIndex:0,verificationRef:"gh:review:112233",
  },verifier);
  assert.equal(proposal.status,"VERIFIED_CANDIDATE");
  assert.equal(proposal.handoff.VERIFIED_EVIDENCE.evidenceClass,"HUMAN_VERIFIED");
  assert.equal(proposal.builderAcknowledged,false);
  assert.equal(proposal.correctionTaskCreated,false);
  assert.equal(proposal.writeAuthorized,false);
  // Even if the human attestation is otherwise authenticated, a mismatched
  // downloaded log must prevent all Builder proposals.
  const changed=createGitHubActionsFailureVerifier({
    repository:REPO,githubGet:evidenceSource.githubGet,
    githubReadJobLog:async()=>Buffer.from("malformed log bytes\n"),
  });
  const rejectVerifier=createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"builder-1",
    allowedReviewerLogins:["separate-reviewer"],
    githubGet:getReview,verifyReproductionEvidence:changed,
  });
  const held=await prepareVerifiedRepairProposal({
    repository:REPO,prNumber:73,review:aiReview,
    trustedPatch:patch,findingIndex:0,verificationRef:"gh:review:112233",
  },rejectVerifier);
  assert.equal(held.status,"TRIAGE_REQUIRED");
  assert.equal(held.handoff,null);
});
