import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createGitHubHumanReproductionVerifier, createGitHubReadOnlyPullReviewClient } from "../scripts/goriq-ai09-github-human-verifier.mjs";
import { prepareVerifiedRepairProposal } from "../scripts/goriq-ai09-independent-triage.mjs";

const A="a".repeat(40),B="b".repeat(40),REPO="haji84/AI-";
const patch="diff --git a/src/repro.mjs b/src/repro.mjs\n@@ -0,0 +1 @@\n+console.log(request.headers.authorization);";
const digest=createHash("sha256").update(patch).digest("hex");
const expected={repository:REPO,prNumber:73,headSha:B,baseSha:A,
  patchSha256:digest,path:"src/repro.mjs",line:1,findingIndex:0};
const caseRef="ci:job:repro123";
const doc=()=>({
  schemaVersion:1,...expected,reproduced:true,
  reproductionCaseRef:caseRef,reproductionSha256:"d".repeat(64)
});
const body=(e=doc())=>"AI09_INDEPENDENT_REPRODUCTION_V1\n"+JSON.stringify(e);
const pr=()=>({number:73,state:"open",user:{login:"pr-author"},
  head:{sha:B,repo:{full_name:REPO}},base:{sha:A,repo:{full_name:REPO}}});
const review=()=>({id:123456,user:{login:"reviewer-1",type:"User"},
  state:"COMMENTED",commit_id:B,submitted_at:"2026-10-16T08:00:00Z",body:body()});
function fixture({pull=pr(),reviews=[review()]}={}){
  const paths=[];
  const githubGet=async path=>{
    paths.push(path);
    if(path==="/pulls/73")return pull;
    if(path==="/pulls/73/reviews?per_page=100&page=1")return reviews;
    throw Error("UNEXPECTED_GITHUB_READ");
  };
  return {paths,githubGet};
}
function adapter(f){
  return createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"builder-1",
    allowedReviewerLogins:["reviewer-1"],githubGet:f.githubGet,
    verifyReproductionEvidence:async({expected,attestation})=>({
      verified:true,headSha:expected.headSha,logSha256:attestation.reproductionSha256,
      conclusion:"failure",evidenceClass:"MACHINE_VERIFIED_LOG_PROVENANCE",
    }),
  });
}
const input={repository:REPO,prNumber:73,
  review:{reviewer:"AI-09",evidenceClass:"AI_ASSERTED",
    status:"CHANGES_REQUESTED",mergeAuthorized:false,
    githubApprovalSatisfied:false,independentGitHubAccountVerified:false,
    scope:{headSha:B,baseSha:A,patchSha256:digest,paths:[expected.path]},
    findings:[{path:expected.path,line:1,
      evidence:"Added `console.log(request.headers.authorization);`",
      severity:"high",summary:"Unsafe auth logging",proposedFix:"Audit code"}]},
  trustedPatch:patch,findingIndex:0,verificationRef:"gh:review:123456",
};

test("authenticated separate human GitHub reproduction yields proposal, not a repair",async()=>{
  const f=fixture();
  const output=await prepareVerifiedRepairProposal(input,adapter(f));
  assert.deepEqual(f.paths,["/pulls/73","/pulls/73/reviews?per_page=100&page=1"]);
  assert.equal(output.status,"VERIFIED_CANDIDATE");
  assert.equal(output.independentVerificationSatisfied,true);
  assert.equal(output.handoff.VERIFIED_EVIDENCE.verifierActor,"reviewer-1");
  assert.equal(output.handoff.VERIFIED_EVIDENCE.evidenceClass,"HUMAN_VERIFIED");
  assert.equal(output.handoff.STATUS,"PROPOSAL_PENDING_AUTHORITY_AND_ACK");
  assert.equal(output.correctionTaskCreated,false);
  assert.equal(output.builderAcknowledged,false);
  assert.equal(output.writeAuthorized,false);
  assert.equal(output.mergeAuthorized,false);
});

test("untrusted or stale GitHub review never authorizes an independent proposal",async()=>{
  const cases=[
    {reviews:[{...review(),commit_id:A}]},
    {reviews:[{...review(),user:{login:"pr-author",type:"User"}}]},
    {reviews:[{...review(),user:{login:"github-actions[bot]",type:"Bot"}}]},
    {reviews:[{...review(),user:{login:"unapproved",type:"User"}}]},
    {reviews:[{...review(),state:"PENDING"}]},
    {reviews:[{...review(),submitted_at:"garbled"}]},
    {reviews:[{...review(),body:body({...doc(),headSha:A})}]},
    {reviews:[{...review(),body:body({...doc(),line:90})}]},
    {reviews:[{...review(),body:body({...doc(),reproduced:false})}]},
    {reviews:[{...review(),body:body({...doc(),reproductionSha256:"bad"})}]},
    {reviews:[{...review(),body:body({...doc(),extra:true})}]},
    {reviews:[]},
    {reviews:[review(),review()]},
    {reviews:Array.from({length:100},()=>review())},
    {pull:{...pr(),head:{...pr().head,sha:A}}},
    {pull:{...pr(),user:{login:"reviewer-1"}}},
  ];
  for(const row of cases){
    const output=await prepareVerifiedRepairProposal(input,adapter(fixture(row)));
    assert.equal(output.status,"TRIAGE_REQUIRED");
    assert.equal(output.handoff,null);
    assert.equal(output.writeAuthorized,false);
  }
});
test("model-supplied proof cannot choose its own GitHub verifier actor or ID",async()=>{
  const f=fixture();
  const output=await prepareVerifiedRepairProposal({
    ...input,verificationRef:"gh:review:999999",
    verification:{authenticated:true,independent:true,reproduced:true},
  },adapter(f));
  assert.equal(output.status,"TRIAGE_REQUIRED");
  assert.equal(output.handoff,null);
});
test("trusted allowlist rejects builder, AI-09, duplicates, or missing getter",()=>{
  for(const reviewers of [["builder-1"],["AI-09"],["reviewer-1","REVIEWER-1"]]){
    assert.throws(()=>createGitHubHumanReproductionVerifier({
      repository:REPO,builderActor:"builder-1",
      allowedReviewerLogins:reviewers,githubGet:fixture().githubGet,
      verifyReproductionEvidence:async()=>null
    }),/INVALID_VERIFIER_ALLOWLIST/);
  }
  assert.throws(()=>createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"builder-1",allowedReviewerLogins:["reviewer-1"]
  }),/INVALID_TRUSTED_VERIFIER_CONFIG/);
});

test("short GitHub actor names remain valid; distinct identity still required",async()=>{
  const f=fixture({reviews:[{...review(),user:{login:"QA",type:"User"}}]});
  const a=createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"Dev",
    allowedReviewerLogins:["QA"],githubGet:f.githubGet,
    verifyReproductionEvidence:async({expected,attestation})=>({
      verified:true,headSha:expected.headSha,logSha256:attestation.reproductionSha256,
      conclusion:"failure",evidenceClass:"MACHINE_VERIFIED_LOG_PROVENANCE",
    }),
  });
  const output=await prepareVerifiedRepairProposal(input,a);
  assert.equal(output.status,"VERIFIED_CANDIDATE");
  assert.equal(output.handoff.VERIFIED_EVIDENCE.verifierActor,"QA");
  assert.equal(output.writeAuthorized,false);
});


test("read-only GitHub client accepts only fixed PR/review endpoints and never POST",async()=>{
  const calls=[];
  const getter=createGitHubReadOnlyPullReviewClient({
    repository:REPO,token:"fixture_token_only",
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      return {ok:true,json:async()=>url.includes("/reviews?")
        ? [review()]:pr()};
    },
  });
  const result=await getter("/pulls/73");
  const reviews=await getter("/pulls/73/reviews?per_page=100&page=1");
  assert.equal(result.number,73);
  assert.equal(reviews[0].id,123456);
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>x.init.method==="GET"&&x.init.redirect==="error"));
  assert.ok(calls.every(x=>x.url.startsWith("https://api.github.com/repos/haji84/AI-/pulls/73")));
  assert.ok(calls.every(x=>x.init.headers.Authorization==="Bearer fixture_token_only"));
  for(const unsafe of [
    "/pulls/73/comments", "/pulls/73/reviews?per_page=100&page=2",
    "/issues/73/comments", "/pulls/73/merge", "/pulls/../73",
    "https://elsewhere.example", "/pulls/73?token=value",
  ])await assert.rejects(getter(unsafe),/UNAUTHORIZED_GITHUB_READ_PATH/);
  assert.equal(calls.length,2);
});

test("GitHub API failures never log or return token or remote error body",async()=>{
  const bad=createGitHubReadOnlyPullReviewClient({
    repository:REPO,token:"read_token_123",
    fetchImpl:async()=>({ok:false,status:403,json:async()=>({
      secret:"read_token_123",
    })}),
  });
  await assert.rejects(bad("/pulls/73"),error=>{
    assert.equal(error.message,"GITHUB_READONLY_REVIEW_UNAVAILABLE");
    assert.doesNotMatch(error.message,/read_token/);
    return true;
  });
  const unavailable=createGitHubReadOnlyPullReviewClient({
    repository:REPO,token:"read_token_123",
    fetchImpl:async()=>{throw Error("should never log private info");},
  });
  await assert.rejects(unavailable("/pulls/73"),/GITHUB_READONLY_REVIEW_UNAVAILABLE/);
  assert.throws(()=>createGitHubReadOnlyPullReviewClient({
    repository:"../different",token:"valid_token_123",
  }),/INVALID_GITHUB_READONLY_CLIENT_CONFIG/);
  assert.throws(()=>createGitHubReadOnlyPullReviewClient({
    repository:"haji84/..",token:"valid_token_123",
  }),/INVALID_GITHUB_READONLY_CLIENT_CONFIG/);
  assert.throws(()=>createGitHubHumanReproductionVerifier({
    repository:"haji84/..",builderActor:"builder-1",
    allowedReviewerLogins:["reviewer-1"],githubGet:fixture().githubGet,
  }),/INVALID_TRUSTED_VERIFIER_CONFIG/);
  assert.throws(()=>createGitHubReadOnlyPullReviewClient({
    repository:REPO,token:"",
  }),/INVALID_GITHUB_READONLY_CLIENT_CONFIG/);
});

test("read-only GitHub REST client can back the independent review contract",async()=>{
  const getter=createGitHubReadOnlyPullReviewClient({
    repository:REPO,token:"fixture_token_only",
    fetchImpl:async(url,init)=>{
      assert.equal(init.method,"GET");
      return {ok:true,json:async()=>url.includes("/reviews?")
        ? [review()]:pr()};
    },
  });
  const verifier=createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"builder-1",
    allowedReviewerLogins:["reviewer-1"],githubGet:getter,
    verifyReproductionEvidence:async({expected,attestation})=>({
      verified:true,headSha:expected.headSha,logSha256:attestation.reproductionSha256,
      conclusion:"failure",evidenceClass:"MACHINE_VERIFIED_LOG_PROVENANCE",
    }),
  });
  const output=await prepareVerifiedRepairProposal(input,verifier);
  assert.equal(output.status,"VERIFIED_CANDIDATE");
  assert.equal(output.writeAuthorized,false);
  assert.equal(output.correctionTaskCreated,false);
});


test("authenticated GitHub review alone cannot promote a repair proposal if raw CI evidence is unavailable",async()=>{
  let checked=0;
  const verifier=createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"builder-1",
    allowedReviewerLogins:["reviewer-1"],githubGet:fixture().githubGet,
    verifyReproductionEvidence:async()=>{checked++;throw Error("log digest mismatch");},
  });
  const result=await prepareVerifiedRepairProposal(input,verifier);
  assert.equal(checked,1);
  assert.equal(result.status,"TRIAGE_REQUIRED");
  assert.equal(result.handoff,null);
});
test("forged failure attestation from trusted identity remains held without matching bytes",async()=>{
  const verifier=createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"builder-1",
    allowedReviewerLogins:["reviewer-1"],githubGet:fixture().githubGet,
    verifyReproductionEvidence:async({expected})=>({
      verified:true,headSha:expected.headSha,logSha256:"0".repeat(64),
      conclusion:"failure",evidenceClass:"MACHINE_VERIFIED_LOG_PROVENANCE",
    }),
  });
  const result=await prepareVerifiedRepairProposal(input,verifier);
  assert.equal(result.status,"TRIAGE_REQUIRED");
  assert.equal(result.handoff,null);
});
