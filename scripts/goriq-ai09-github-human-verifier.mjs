// Read-only GitHub-native human reproduction attestation reader.
// GitHub authenticates the review author; the *trusted controller* owns the
// allowlist. The AI-09 model and PR author cannot appoint their own verifier.
// This is HUMAN_VERIFIED attestation, not independently executed tests.
import { createHash } from "node:crypto";

const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const ACTOR=/^[A-Za-z0-9-]{1,39}$/;
const REF=/^[A-Za-z0-9_:/.-]{8,128}$/;
const PREFIX="AI09_INDEPENDENT_REPRODUCTION_V1\n";
function validRepository(value) {
  if(typeof value!=="string"||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value))return false;
  const [owner,name]=value.split("/");
  return owner!=="." && owner!==".." && name!=="." && name!=="..";
}


// Trusted controller wiring for the read-only GitHub verification adapter.
// Only fixed pull request metadata and bounded reviews can be fetched.
// Never use a model-chosen route, HTTP method, repository or credential.
export function createGitHubReadOnlyPullReviewClient({
  repository, token, fetchImpl = fetch,
}) {
  if(!validRepository(repository) ||
     typeof token!=="string" || token.length<8 || token.length>2048 ||
     typeof fetchImpl!=="function")
    throw Error("INVALID_GITHUB_READONLY_CLIENT_CONFIG");
  const pathPattern=/^\/pulls\/[1-9][0-9]{0,9}(?:\/reviews\?per_page=100&page=1)?$/;
  return async path=>{
    if(typeof path!=="string"||!pathPattern.test(path))
      throw Error("UNAUTHORIZED_GITHUB_READ_PATH");
    let response;
    try {
      response=await fetchImpl("https://api.github.com/repos/"+repository+path,{
        method:"GET",
        headers:{
          Accept:"application/vnd.github+json",
          Authorization:"Bearer "+token,
          "X-GitHub-Api-Version":"2022-11-28",
          "User-Agent":"GORIQ-AI09-independent-readonly-verifier",
        },
        redirect:"error",
        signal:AbortSignal.timeout(15000),
      });
    } catch {
      throw Error("GITHUB_READONLY_REVIEW_UNAVAILABLE");
    }
    if(!response||response.ok!==true)
      throw Error("GITHUB_READONLY_REVIEW_UNAVAILABLE");
    try {return await response.json();}
    catch {throw Error("INVALID_GITHUB_READONLY_REVIEW_RESPONSE");}
  };
}


export function createGitHubHumanReproductionVerifier({
  repository,builderActor,allowedReviewerLogins,githubGet,verifyReproductionEvidence,
}) {
  if(!validRepository(repository)||
     !ACTOR.test(builderActor??"")||
     !Array.isArray(allowedReviewerLogins)||
     allowedReviewerLogins.length<1||allowedReviewerLogins.length>20||
     !allowedReviewerLogins.every(x=>ACTOR.test(x))||
     typeof githubGet!=="function"||
     typeof verifyReproductionEvidence!=="function")throw Error("INVALID_TRUSTED_VERIFIER_CONFIG");
  const allowed=new Set(allowedReviewerLogins.map(x=>x.toLowerCase()));
  if(allowed.size!==allowedReviewerLogins.length ||
     allowed.has("ai-09")||allowed.has("github-actions")||
     allowed.has(builderActor.toLowerCase()))throw Error("INVALID_VERIFIER_ALLOWLIST");

  return async ({verificationRef,expected})=>{
    const match=/^gh:review:([1-9][0-9]{0,15})$/.exec(verificationRef??"");
    if(!match||!expected||expected.repository!==repository||
       !Number.isSafeInteger(expected.prNumber)||expected.prNumber<1||
       !SHA40.test(expected.headSha??"")||!SHA40.test(expected.baseSha??"")||
       !SHA256.test(expected.patchSha256??"")||
       typeof expected.path!=="string"||
       !Number.isSafeInteger(expected.line)||expected.line<1||
       !Number.isSafeInteger(expected.findingIndex)||expected.findingIndex<0)
      throw Error("INVALID_GITHUB_VERIFICATION_SCOPE");
    const reviewId=Number(match[1]);
    if(!Number.isSafeInteger(reviewId))throw Error("INVALID_GITHUB_REVIEW_ID");

    const number=expected.prNumber;
    const pr=await githubGet("/pulls/"+number);
    if(pr?.number!==number||pr?.state!=="open"||
       pr.head?.sha!==expected.headSha||pr.base?.sha!==expected.baseSha||
       pr.head?.repo?.full_name!==repository||
       pr.base?.repo?.full_name!==repository||
       !ACTOR.test(pr.user?.login??""))
      throw Error("STALE_OR_UNTRUSTED_GITHUB_PR");

    // One bounded page only. Full inventory must be available or HOLD.
    const reviews=await githubGet("/pulls/"+number+"/reviews?per_page=100&page=1");
    if(!Array.isArray(reviews)||reviews.length>=100)
      throw Error("GITHUB_REVIEW_INVENTORY_INCOMPLETE");
    const matching=reviews.filter(x=>x?.id===reviewId);
    if(matching.length!==1)throw Error("AUTHENTICATED_GITHUB_REVIEW_MISSING");
    const review=matching[0],actor=review.user?.login;
    if(review.state!=="COMMENTED"||review.user?.type!=="User"||
       review.commit_id!==expected.headSha||!ACTOR.test(actor??"")||
       !allowed.has(actor.toLowerCase())||
       actor.toLowerCase()===pr.user.login.toLowerCase()||
       actor.toLowerCase()===builderActor.toLowerCase()||
       !Number.isFinite(Date.parse(review.submitted_at??""))||
       typeof review.body!=="string"||review.body.length>3072||
       !review.body.startsWith(PREFIX))
      throw Error("INDEPENDENT_GITHUB_REVIEW_NOT_TRUSTED");

    // The authenticated human attests reproduction. No model JSON can forge
    // the review account or its GitHub-pinned commit SHA. Reject surplus fields.
    let attestation;
    try {attestation=JSON.parse(review.body.slice(PREFIX.length));}
    catch {throw Error("INVALID_REPRODUCTION_ATTESTATION");}
    const keys=["schemaVersion","repository","prNumber","headSha","baseSha",
      "patchSha256","path","line","findingIndex","reproduced",
      "reproductionCaseRef","reproductionSha256"];
    if(!attestation||typeof attestation!=="object"||Array.isArray(attestation)||
       Object.keys(attestation).length!==keys.length||
       !keys.every(k=>Object.hasOwn(attestation,k))||
       attestation.schemaVersion!==1||attestation.reproduced!==true||
       keys.slice(1,9).some(k=>attestation[k]!==expected[k])||
       typeof attestation.reproductionCaseRef!=="string"||
       !REF.test(attestation.reproductionCaseRef)||
       attestation.reproductionCaseRef.includes("..")||
       !SHA256.test(attestation.reproductionSha256??""))
      throw Error("REPRODUCTION_ATTESTATION_SCOPE_MISMATCH");

    // Review-author identity proves who made the statement, not that a
    // failure happened. Independently re-fetch the exact CI job and raw log,
    // and require a byte-for-byte SHA-256 match before promoting the proposal.
    let reproduction;
    try {
      reproduction=await verifyReproductionEvidence({expected,attestation});
    } catch {
      throw Error("REPRODUCTION_LOG_UNVERIFIED");
    }
    if(reproduction?.verified!==true ||
       reproduction?.headSha!==expected.headSha ||
       reproduction?.logSha256!==attestation.reproductionSha256 ||
       reproduction?.conclusion!=="failure" ||
       reproduction?.evidenceClass!=="MACHINE_VERIFIED_LOG_PROVENANCE")
      throw Error("REPRODUCTION_LOG_UNVERIFIED");
    return {
      ...expected, authenticated:true,independent:true,reproduced:true,
      evidenceClass:"HUMAN_VERIFIED",evidenceId:verificationRef,
      evidenceSha256:createHash("sha256").update(review.body).digest("hex"),
      verifierActor:actor,builderActor,
    };
  };
}
