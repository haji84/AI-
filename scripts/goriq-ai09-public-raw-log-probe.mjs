// Real GitHub-hosted read-only raw-log provenance probe, never a defect verifier.
// This exact historic CI failure is deliberately immutable; it is not eligible
// to authorize a repair for a *different/current* PR head.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createGitHubReadOnlyActionsClient } from "./goriq-ai09-actions-proof.mjs";

const REPO="haji84/AI-";
const RUN_ID=38926717190, JOB_ID=117060019163;
const HISTORIC_SHA="af16e06f91334a3cca97916a500d4b7174fcc376";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");

export async function probeHistoricRawLog({ fetchImpl=fetch, outputPath }={}) {
  // Repository is publicly readable. No GitHub bearer or other credential
  // is forwarded, even to the GitHub API. The existing client also checks
  // signed log redirect hosts and enforces a strict 2 MiB streaming cap.
  const publicFetch=(url,init)=>{
    const {Authorization:unused,...safe}=init?.headers??{};
    void unused;
    return fetchImpl(url,{...init,headers:Object.keys(safe).length?safe:undefined});
  };
  const client=createGitHubReadOnlyActionsClient({
    repository:REPO,token:"anonymous-public",
    fetchImpl:publicFetch,
  });
  let job,run;
  try {
    [job,run]=await Promise.all([
      client.githubGet("/actions/jobs/"+JOB_ID),
      client.githubGet("/actions/runs/"+RUN_ID),
    ]);
  } catch {throw Error("GITHUB_PUBLIC_JOB_METADATA_UNAVAILABLE");}
  if(job?.id!==JOB_ID||job?.run_id!==RUN_ID||
     job?.head_sha!==HISTORIC_SHA||job?.status!=="completed"||
     job?.conclusion!=="failure"||
     run?.id!==RUN_ID||run?.head_sha!==HISTORIC_SHA||
     run?.status!=="completed"||run?.conclusion!=="failure"||
     run?.event!=="pull_request"||run?.name!=="CI"||
     run?.repository?.full_name!==REPO)
    throw Error("HISTORIC_SOURCE_PROVENANCE_NOT_VERIFIED");

  // Two separate live downloads of GitHub's signed original log, not a
  // connector-decoded text re-encoding. No model output supplies the hash.
  let first,second;
  try {first=await client.githubReadJobLog(JOB_ID);}
  catch {throw Error("GITHUB_PUBLIC_RAW_LOG_DOWNLOAD_ONE_UNAVAILABLE");}
  try {second=await client.githubReadJobLog(JOB_ID);}
  catch {throw Error("GITHUB_PUBLIC_RAW_LOG_DOWNLOAD_TWO_UNAVAILABLE");}
  const digest1=sha(first),digest2=sha(second);
  if(first.length<32||first.length!==second.length||digest1!==digest2||
     !first.equals(second))throw Error("RAW_LOG_RETRIEVAL_MISMATCH");
  const receipt={
    schemaVersion:1,source:"GITHUB_ACTIONS_RAW_LOG_TWO_INDEPENDENT_DOWNLOADS",
    repository:REPO,runId:RUN_ID,jobId:JOB_ID,
    immutableHeadSha:HISTORIC_SHA,bytes:first.length,sha256:digest1,
    runsReportedFailure:true,jobReportedFailure:true,
    rawBytesReFetchedAndMatched:true,
    historicalProofOnly:true,currentHeadDefectVerified:false,
    independentHumanReviewVerified:false,realBuilderAcknowledgementVerified:false,
    githubApprovalSatisfied:false,mergeAuthorized:false,
  };
  if(outputPath)writeFileSync(outputPath,JSON.stringify(receipt,null,2)+"\n",{mode:0o600,flag:"wx"});
  return receipt;
}

if(process.argv[1]&&process.argv[1].endsWith("goriq-ai09-public-raw-log-probe.mjs")){
  probeHistoricRawLog({outputPath:process.env.GORIQ_AI09_RAW_PROOF_PATH})
    .then(x=>console.log("AI09_RAW_LOG_EVIDENCE="+JSON.stringify(x)))
    .catch(error=>{
      const known=new Set([
        "GITHUB_PUBLIC_JOB_METADATA_UNAVAILABLE",
        "HISTORIC_SOURCE_PROVENANCE_NOT_VERIFIED",
        "GITHUB_PUBLIC_RAW_LOG_DOWNLOAD_ONE_UNAVAILABLE",
        "GITHUB_PUBLIC_RAW_LOG_DOWNLOAD_TWO_UNAVAILABLE",
        "RAW_LOG_RETRIEVAL_MISMATCH",
      ]);
      const code=known.has(error?.message)?error.message:"UNEXPECTED_READONLY_FAILURE";
      console.error("AI09_RAW_LOG_EVIDENCE=INCONCLUSIVE;REASON="+code);
      process.exitCode=2;
    });
}
