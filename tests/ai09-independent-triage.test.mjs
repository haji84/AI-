import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { anchorAudit } from "../scripts/goriq-ai09-finding-anchors.mjs";
import { prepareVerifiedRepairProposal } from "../scripts/goriq-ai09-independent-triage.mjs";

const A="a".repeat(40),B="b".repeat(40),REPO="haji84/AI-";
const patch="diff --git a/src/example.mjs b/src/example.mjs\n@@ -0,0 +1 @@\n+console.log(request.headers.authorization);";
const sha=createHash("sha256").update(patch).digest("hex");
const finding={path:"src/example.mjs",line:1,severity:"high",
  evidence:"Code `console.log(request.headers.authorization);` added",
  summary:"Logging risk",proposedFix:"Review this operation"};
const review={reviewer:"AI-09",evidenceClass:"AI_ASSERTED",status:"CHANGES_REQUESTED",
  githubApprovalSatisfied:false,mergeAuthorized:false,
  independentGitHubAccountVerified:false,
  scope:{headSha:B,baseSha:A,patchSha256:sha,paths:[finding.path]},
  findings:[finding]};
const input={repository:REPO,prNumber:73,review,trustedPatch:patch,
  findingIndex:0,verificationRef:"ci:job:87654321"};
const proof=expected=>({authenticated:true,independent:true,reproduced:true,
  evidenceClass:"MACHINE_VERIFIED",evidenceId:"ci:job:87654321",
  evidenceSha256:"c".repeat(64),verifierActor:"Verifier01",builderActor:"Builder01",
  ...expected});

test("bad line, path and fabricated quotes are not code-grounded",()=>{
  assert.equal(anchorAudit([finding],patch).complete,true);
  for(const bad of [
    {...finding,line:123},
    {...finding,path:"src/wrong.mjs"},
    {...finding,evidence:"JSON is untrusted"},
    {...finding,evidence:"Alleged prompt delimiter is real code"},
  ])assert.equal(anchorAudit([bad],patch).complete,false);
});
test("no trusted adapter rejects candidate, even with self-reported verification",async()=>{
  const r=await prepareVerifiedRepairProposal({...input,verification:{authenticated:true}});
  assert.equal(r.status,"TRIAGE_REQUIRED");
  assert.equal(r.reason,"TRUSTED_VERIFIER_ADAPTER_REQUIRED");
  assert.equal(r.handoff,null);
});
test("bad review, patch, line, reference never reach verifier",async()=>{
  let called=0;
  const requests=[
    {...input,review:{...review,scope:{...review.scope,headSha:A}}},
    {...input,review:{...review,scope:{...review.scope,patchSha256:"e".repeat(64)}}},
    {...input,review:{...review,findings:[{...finding,line:123}]}},
    {...input,review:{...review,findings:[{...finding,evidence:"generic warning"}]}},
    {...input,review:{...review,mergeAuthorized:true}},
    {...input,verificationRef:"invalid ref"},
  ];
  for(const req of requests){
    const out=await prepareVerifiedRepairProposal(req,async()=>{called++;return null;});
    assert.equal(out.status,"TRIAGE_REQUIRED");
    assert.equal(out.correctionTaskCreated,false);
  }
  assert.equal(called,0);
});
test("untrusted or stale independent attestation holds correction proposal",async()=>{
  const expected={repository:REPO,prNumber:73,headSha:B,baseSha:A,patchSha256:sha,
    path:finding.path,line:1,findingIndex:0};
  for(const override of [
    {authenticated:false},{independent:false},{reproduced:false},
    {headSha:A},{baseSha:B},{path:"src/other.mjs"},{line:123},
    {evidenceClass:"AI_ASSERTED"},{verifierActor:"Builder01"},
  ]){
    const out=await prepareVerifiedRepairProposal(input,async()=>({...proof(expected),...override}));
    assert.equal(out.status,"TRIAGE_REQUIRED");
    assert.equal(out.handoff,null);
  }
});
test("failed verifier stays HOLD and emits no untrusted exception content",async()=>{
  const r=await prepareVerifiedRepairProposal(input,async()=>{throw Error("untrusted details");});
  assert.equal(r.reason,"INDEPENDENT_VERIFIER_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(r),/untrusted details/);
});
test("separately authenticated reproduction builds proposal without task dispatch",async()=>{
  const out=await prepareVerifiedRepairProposal(input,async({verificationRef,expected})=>{
    assert.equal(verificationRef,input.verificationRef);
    assert.equal(expected.patchSha256,sha);
    return proof(expected);
  });
  assert.equal(out.status,"VERIFIED_CANDIDATE");
  assert.equal(out.handoff.TARGET_AGENT,"Builder/Debugger");
  assert.equal(out.handoff.STATUS,"PROPOSAL_PENDING_AUTHORITY_AND_ACK");
  assert.deepEqual(out.handoff.FILES_ALLOWED,[finding.path]);
  assert.equal(out.correctionTaskCreated,false);
  assert.equal(out.builderAcknowledged,false);
  assert.equal(out.writeAuthorized,false);
  assert.equal(out.githubApprovalSatisfied,false);
  assert.equal(out.mergeAuthorized,false);
  assert.doesNotMatch(JSON.stringify(out),/Review this operation|Logging risk/);
});
