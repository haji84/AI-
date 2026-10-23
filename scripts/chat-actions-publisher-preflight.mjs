#!/usr/bin/env node
// Trusted default-branch workflow_run preflight. No secrets, no code writes.
import { readFileSync, appendFileSync } from "node:fs";
import { verifyPilotRun, readTrustedState } from "./chat-actions-trusted-publisher.mjs";

const REPO="haji84/AI-";
const ARTIFACT="chat-actions-real-model-candidate";
const OWNER="haji84";
const APPROVAL_PREFIX="AUTHORIZE_GORIQ_TRUSTED_PUBLISHER_1865";
const HEX40=/^[a-f0-9]{40}$/;
export function ownerApprovalForPublisher(comments,{trustedMainSha,now=Date.now()}) {
  if(!HEX40.test(trustedMainSha??"") || !Array.isArray(comments) ||
    comments.length>=100 || !Number.isFinite(now)) return false;
  const prefix=APPROVAL_PREFIX+" main="+trustedMainSha+" expiry=";
  return comments.some(c=>{
    if(c?.user?.login!==OWNER || c?.author_association!=="OWNER" ||
      typeof c?.body!=="string" || !c.body.startsWith(prefix)) return false;
    const remainder=c.body.slice(prefix.length);
    if(!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/.test(remainder.trim()))return false;
    const expiry=Date.parse(remainder.trim());
    const created=Date.parse(c.created_at??"");
    return Number.isFinite(expiry) && Number.isFinite(created) &&
      created<=now && expiry>now && expiry-created<=7*86400_000;
  });
}

export async function preflightPublisher({event, token, fetchImpl=fetch, trustedMainSha, now=Date.now()}) {
  const provenance=verifyPilotRun(event);
  const state=await readTrustedState({event,token,fetchImpl});
  // An already fixed PR is never re-written by the publisher.
  if(state.currentFile==="export function add(a, b) { return a + b; }\n")
    return {eligible:false,reason:"ALREADY_FIXED",head:provenance.headSha};
  if(state.currentFile!=="export function add(a, b) { return a - b; }\n")
    return {eligible:false,reason:"FIXTURE_BASELINE_UNKNOWN",head:provenance.headSha};

  // Explicit owner decision, bound to the trusted default-branch commit and a short expiry.
  const approvalRes=await fetchImpl("https://api.github.com/repos/"+REPO+"/issues/1865/comments?per_page=100",{
    method:"GET",redirect:"error",signal:AbortSignal.timeout(15_000),
    headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28"},
  });
  if(!approvalRes.ok)throw Error("HUMAN_GATE_AUDIT_UNAVAILABLE_"+approvalRes.status);
  const approvalComments=await approvalRes.json();
  if(!ownerApprovalForPublisher(approvalComments,{trustedMainSha,now}))
    return {eligible:false,reason:"OWNER_ACTIVATION_APPROVAL_REQUIRED",head:provenance.headSha};

  const url="https://api.github.com/repos/"+REPO+
    "/actions/runs/"+provenance.runId+"/artifacts?per_page=100";
  const response=await fetchImpl(url,{
    method:"GET",redirect:"error",signal:AbortSignal.timeout(15_000),
    headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28"},
  });
  if(!response.ok)throw Error("RUN_ARTIFACTS_READ_FAILED_"+response.status);
  const payload=await response.json();
  if(!Array.isArray(payload.artifacts) || payload.artifacts.length>100 ||
      payload.total_count>100)
    throw Error("INCOMPLETE_ARTIFACT_INVENTORY");
  const found=payload.artifacts.filter(a=>a.name===ARTIFACT && !a.expired);
  if(found.length===0)return {eligible:false,reason:"NO_REAL_MODEL_CANDIDATE",head:provenance.headSha};
  if(found.length!==1 || !Number.isSafeInteger(found[0].id) || found[0].id<1)
    throw Error("AMBIGUOUS_CANDIDATE_ARTIFACT");
  return {eligible:true,reason:"EXACT_HEAD_RUN_AND_ARTIFACT",head:provenance.headSha,
    artifactId:found[0].id,runId:provenance.runId};
}
if(process.argv[1]?.endsWith("/chat-actions-publisher-preflight.mjs")){
  const env=process.env;
  if(env.GITHUB_EVENT_NAME!=="workflow_run" || env.GITHUB_REPOSITORY!==REPO ||
    !env.GITHUB_EVENT_PATH || !env.GITHUB_TOKEN || !env.GITHUB_OUTPUT)
    throw Error("TRUSTED_PREFLIGHT_CONTEXT_REQUIRED");
  const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,"utf8"));
  const r=await preflightPublisher({event,token:env.GITHUB_TOKEN,
    trustedMainSha:env.GITHUB_SHA});
  appendFileSync(env.GITHUB_OUTPUT,"eligible="+String(r.eligible)+"\n"+
    "reason="+r.reason+"\n");
  process.stdout.write(JSON.stringify(r)+"\n");
}
