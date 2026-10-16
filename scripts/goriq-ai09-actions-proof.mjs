// Read-only GitHub Actions failure evidence gate.
// A failed CI job and exact raw log SHA are provenance, not by themselves
// proof that a particular AI-09 finding is substantively correct.
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const SHA=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const JOB_REF=/^gh:job:([1-9][0-9]{0,14})$/;
const MAX_LOG_BYTES=2*1024*1024;

function safeRepository(repo) {
  return typeof repo==="string"&&REPO.test(repo)&&
    repo.split("/").every(part=>part!=="."&&part!=="..");
}
function safeNumber(v) {
  return Number.isSafeInteger(v)&&v>0;
}
// Caller-provided API/bytes suppliers must be constructed by trusted code;
// model text cannot choose URL, GitHub identity, credentials or methods.
export function createGitHubActionsFailureVerifier({
  repository, githubGet, githubReadJobLog,
}) {
  if(!safeRepository(repository)||typeof githubGet!=="function"||
     typeof githubReadJobLog!=="function")
    throw Error("INVALID_ACTIONS_EVIDENCE_CONFIG");
  return async ({expected,attestation})=>{
    const match=JOB_REF.exec(attestation?.reproductionCaseRef??"");
    const expectedHash=attestation?.reproductionSha256;
    if(!match||!SHA256.test(expectedHash??"")||
       expected?.repository!==repository||!safeNumber(expected.prNumber)||
       !SHA.test(expected.headSha??"")||!SHA.test(expected.baseSha??"")||
       !SHA256.test(expected.patchSha256??""))
      throw Error("INVALID_ACTIONS_EVIDENCE_SCOPE");
    const jobId=Number(match[1]);
    if(!safeNumber(jobId))throw Error("INVALID_ACTIONS_JOB_ID");
    let job,run,log;
    try {
      job=await githubGet("/actions/jobs/"+jobId);
      if(!safeNumber(job?.run_id)||job.id!==jobId||
         job.status!=="completed"||job.conclusion!=="failure"||
         job.head_sha!==expected.headSha ||
         typeof job.name!=="string" || !job.name.trim())
        throw Error("UNVERIFIED_FAILURE_JOB");
      run=await githubGet("/actions/runs/"+job.run_id);
      if(run?.id!==job.run_id||run.status!=="completed"||
         run.conclusion!=="failure"||
         run.event!=="pull_request"||run.name!=="CI"||
         run.head_sha!==expected.headSha||
         run.repository?.full_name!==repository ||
         !Array.isArray(run.pull_requests)||
         !run.pull_requests.some(pr=>
           pr.number===expected.prNumber&&
           pr.head?.sha===expected.headSha&&
           pr.base?.sha===expected.baseSha&&
           pr.head?.repo?.id===run.repository?.id&&
           pr.base?.repo?.id===run.repository?.id))
        throw Error("UNTRUSTED_REPRODUCTION_CI_RUN");
      log=await githubReadJobLog(jobId);
    } catch {
      throw Error("ACTIONS_EVIDENCE_UNAVAILABLE_OR_STALE");
    }
    if(!(typeof log==="string"||Buffer.isBuffer(log)))
      throw Error("INVALID_ACTIONS_LOG_BODY");
    const bytes=Buffer.isBuffer(log)?log:Buffer.from(log,"utf8");
    if(bytes.length<32||bytes.length>MAX_LOG_BYTES)
      throw Error("UNREVIEWABLE_ACTIONS_LOG_SIZE");
    const actual=createHash("sha256").update(bytes).digest("hex");
    if(actual!==expectedHash)throw Error("ACTIONS_LOG_SHA256_MISMATCH");
    // A code-claimed defect is still not proven by a matching log: separate
    // authenticated human attestation and governed task authority are required.
    return {
      verified:true,jobId,runId:job.run_id,
      headSha:expected.headSha,logSha256:actual,
      logBytes:bytes.length,conclusion:"failure",
      evidenceClass:"MACHINE_VERIFIED_LOG_PROVENANCE",
      underlyingDefectVerified:false,
    };
  };
}

// Safe fixed-route HTTP client for the existing GitHub Actions REST endpoints.
// Job logs redirect to a GitHub-managed storage host; never forward the API
// bearer token, cookies, or attacker-controlled authorization across hosts.
export function createGitHubReadOnlyActionsClient({
  repository,token,fetchImpl=fetch,
}) {
  if(!safeRepository(repository)||typeof token!=="string"||
     token.length<8||token.length>2048||typeof fetchImpl!=="function")
    throw Error("INVALID_ACTIONS_READONLY_CLIENT_CONFIG");
  const route=/^\/actions\/(?:jobs|runs)\/[1-9][0-9]{0,14}$/;
  const logRoute=/^\/actions\/jobs\/[1-9][0-9]{0,14}\/logs$/;
  async function request(path,log) {
    if(typeof path!=="string"||
       !(log?logRoute:route).test(path))
      throw Error("UNAUTHORIZED_ACTIONS_READ_PATH");
    let response;
    try {
      response=await fetchImpl("https://api.github.com/repos/"+repository+path,{
        method:"GET",redirect:"manual",
        headers:{
          Accept:"application/vnd.github+json",
          Authorization:"Bearer "+token,
          "X-GitHub-Api-Version":"2022-11-28",
          "User-Agent":"GORIQ-AI09-Actions-readonly-verifier",
        },
        signal:AbortSignal.timeout(15000),
      });
    } catch {throw Error("ACTIONS_READ_UNAVAILABLE");}
    if(log && (response?.status===302||response?.status===307)){
      const location=response.headers?.get("location");
      let url;
      try {url=new URL(location);} catch {throw Error("UNTRUSTED_ACTIONS_LOG_REDIRECT");}
      const host=url.hostname.toLowerCase();
      // Reject arbitrary hosts, lookalikes, insecure URLs, credentials and ports.
      if(url.protocol!=="https:"||url.username||url.password||url.port||
        !(host.endsWith(".githubusercontent.com")||
          host==="githubusercontent.com"||
          host.endsWith(".blob.core.windows.net")))
        throw Error("UNTRUSTED_ACTIONS_LOG_REDIRECT");
      try {
        // Signed download URL is supplied by GitHub, not by model/PR text.
        // Do not pass the GitHub token or follow a second redirect.
        response=await fetchImpl(url.toString(),{
          method:"GET",redirect:"manual",signal:AbortSignal.timeout(15000),
        });
      } catch {throw Error("ACTIONS_READ_UNAVAILABLE");}
    }
    if(response?.status!==200)throw Error("ACTIONS_READ_UNAVAILABLE");
    if(log) {
      const declared=Number(response.headers?.get("content-length"));
      if(declared>MAX_LOG_BYTES)throw Error("UNREVIEWABLE_ACTIONS_LOG_SIZE");
      let data;
      try {data=Buffer.from(await response.arrayBuffer());}
      catch {throw Error("ACTIONS_READ_UNAVAILABLE");}
      if(data.length>MAX_LOG_BYTES)throw Error("UNREVIEWABLE_ACTIONS_LOG_SIZE");
      return data;
    }
    try {return await response.json();}
    catch {throw Error("INVALID_ACTIONS_METADATA");}
  }
  return {
    githubGet: path=>request(path,false),
    githubReadJobLog: id=>{
      if(!safeNumber(id))throw Error("UNAUTHORIZED_ACTIONS_READ_PATH");
      return request("/actions/jobs/"+id+"/logs",true);
    },
  };
}
