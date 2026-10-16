import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createGitHubHumanReproductionVerifier } from "../scripts/goriq-ai09-github-human-verifier.mjs";
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
      allowedReviewerLogins:reviewers,githubGet:fixture().githubGet
    }),/INVALID_VERIFIER_ALLOWLIST/);
  }
  assert.throws(()=>createGitHubHumanReproductionVerifier({
    repository:REPO,builderActor:"builder-1",allowedReviewerLogins:["reviewer-1"]
  }),/INVALID_TRUSTED_VERIFIER_CONFIG/);
});
