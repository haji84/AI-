#!/usr/bin/env node
// Trusted, fixed-scope Actions publisher. NEVER execute from PR-head code.
// Only a completed, same-repository pilot run may propose the known fixture correction.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REPOSITORY = "haji84/AI-";
const ISSUE = 1865, PR = 1866;
const WORKFLOW = "Chat Actions Isolated Smoke (Non-Production)";
const BRANCH = "codex/1865-pr-reuse-advisory";
const FILE = "tests/fixtures/chat-actions-model-candidate.mjs";
const BROKEN = "export function add(a, b) { return a - b; }\n";
const FIXED = "export function add(a, b) { return a + b; }\n";
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROOT = "https://api.github.com";
const OWNER="haji84";
const APPROVAL_PREFIX="AUTHORIZE_GORIQ_TRUSTED_PUBLISHER_1865";
const graphqlUrl = "https://api.github.com/graphql";
const sha256 = s => createHash("sha256").update(s).digest("hex");

const safeNumber = x => Number.isSafeInteger(x) && x > 0;
const fixedScope = (r) => r?.number === PR && r?.state === "open" && r?.draft === true &&
  r?.base?.repo?.full_name === REPOSITORY && r?.head?.repo?.full_name === REPOSITORY &&
  r?.base?.ref === "main" && r?.head?.ref === BRANCH &&
  SHA.test(r?.head?.sha ?? "") && SHA.test(r?.base?.sha ?? "") &&
  typeof r?.body === "string" && /(?:^|\n)Refs #1865(?:\b|\.)/i.test(r.body);

export function ownerApprovalForPublisher(comments,{trustedMainSha,now=Date.now()}) {
  if(!SHA.test(trustedMainSha??"") || !Array.isArray(comments) ||
    comments.length>=100 || !Number.isFinite(now)) return false;
  const prefix=APPROVAL_PREFIX+" main="+trustedMainSha+" expiry=";
  return comments.some(c=>{
    if(c?.user?.login!==OWNER || c?.author_association!=="OWNER" ||
      typeof c?.body!=="string" || !c.body.startsWith(prefix)) return false;
    const remainder=c.body.slice(prefix.length);
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(remainder.trim()))return false;
    const expiry=Date.parse(remainder.trim());
    const created=Date.parse(c.created_at??"");
    return Number.isFinite(expiry) && Number.isFinite(created) &&
      created<=now && expiry>now && expiry-created<=7*86400_000;
  });
}

export function verifyPilotRun(event) {
  const run = event?.workflow_run;
  if (event?.repository?.full_name !== REPOSITORY ||
    !safeNumber(run?.id) || run?.event !== "pull_request" ||
    run?.name !== WORKFLOW || run?.conclusion !== "success" ||
    run?.status !== "completed" ||
    run?.head_repository?.full_name !== REPOSITORY ||
    run?.head_branch !== BRANCH || !SHA.test(run?.head_sha ?? "") ||
    !Array.isArray(run?.pull_requests) || run.pull_requests.length !== 1 ||
    run.pull_requests[0]?.number !== PR ||
    run.pull_requests[0]?.head?.sha !== run.head_sha)
    throw Error("UNTRUSTED_PILOT_RUN");
  return {runId:run.id, headSha:run.head_sha, prNumber:PR};
}

export function verifyPilotArtifact(receipt, source, provenance) {
  if (!receipt || !provenance || receipt.accepted !== true ||
    receipt.producer !== "OLLAMA_REAL_MODEL" ||
    receipt.model !== "qwen2.5-coder:3b" ||
    receipt.authority !== "CANDIDATE_ONLY_NO_REMOTE_WRITE" ||
    receipt.path !== FILE || receipt.issue !== ISSUE || receipt.pr !== PR ||
    receipt.headSha !== provenance.headSha ||
    !HASH.test(receipt.beforeHash ?? "") || !HASH.test(receipt.afterHash ?? "") ||
    receipt.beforeHash !== sha256(BROKEN) || receipt.afterHash !== sha256(FIXED) ||
    source !== FIXED || sha256(source) !== receipt.afterHash)
    throw Error("MODEL_ARTIFACT_OUT_OF_SCOPE");
  return { path:FILE, beforeHash:receipt.beforeHash, afterHash:receipt.afterHash, source };
}

export function preparePublication({event, pr, receipt, source, currentFile}) {
  const provenance=verifyPilotRun(event);
  if (!fixedScope(pr) || pr.head.sha !== provenance.headSha)
    throw Error("PR_HEAD_CHANGED_OR_SCOPE_MISMATCH");
  const verified=verifyPilotArtifact(receipt,source,provenance);
  if (currentFile === FIXED) return {
    action:"NOOP_ALREADY_FIXED",headSha:provenance.headSha,pr:PR,approved:false
  };
  if (currentFile !== BROKEN || sha256(currentFile) !== verified.beforeHash)
    throw Error("FIXTURE_BASELINE_MISMATCH");
  return {action:"CANDIDATE_VALIDATED",headSha:provenance.headSha,
    pr:PR,branch:BRANCH,path:FILE,source:verified.source,approved:false};
}

export function buildCompareAndSwapMutation(plan) {
  if (plan?.action !== "CANDIDATE_VALIDATED" ||
      !SHA.test(plan.headSha ?? "") || plan.branch !== BRANCH ||
      plan.path !== FILE || plan.source !== FIXED || plan.pr !== PR)
    throw Error("INVALID_PUBLISH_PLAN");
  return {
    query:"mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}",
    variables:{ input:{
      branch:{repositoryNameWithOwner:REPOSITORY, branchName:BRANCH},
      expectedHeadOid:plan.headSha,
      message:{headline:"fix(1865): publish independently validated Ollama fixture repair"},
      fileChanges:{additions:[{path:FILE, contents:Buffer.from(FIXED).toString("base64")}]},
    }},
  };
}

async function githubGet(fetchImpl, token, endpoint) {
  if (!endpoint.startsWith(ROOT + "/repos/" + REPOSITORY + "/"))
    throw Error("UNSUPPORTED_GITHUB_RESOURCE");
  const response=await fetchImpl(endpoint,{
    method:"GET",redirect:"error",signal:AbortSignal.timeout(15_000),
    headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28"},
  });
  if (!response.ok) throw Error("GITHUB_READ_UNAVAILABLE_"+response.status);
  return response.json();
}

export async function readTrustedState({fetchImpl,token,event}) {
  if (!token || typeof token !== "string") throw Error("GITHUB_WRITE_TOKEN_UNAVAILABLE");
  const run=verifyPilotRun(event);
  // PR and candidate branch must still match the exact generating run.
  const pr=await githubGet(fetchImpl,token,ROOT+"/repos/"+REPOSITORY+"/pulls/"+PR);
  if (!fixedScope(pr) || pr.head.sha !== run.headSha)
    throw Error("PR_HEAD_CHANGED_OR_SCOPE_MISMATCH");
  const current=await githubGet(fetchImpl,token,
    ROOT+"/repos/"+REPOSITORY+"/contents/"+FILE+"?ref="+run.headSha);
  if (current?.encoding !== "base64" || typeof current.content !== "string" ||
      current.content.length > 500 || !SHA.test(current.sha ?? ""))
    throw Error("CURRENT_FILE_UNVERIFIED");
  const bytes=Buffer.from(current.content.replace(/\s/g,""),"base64");
  if (bytes.length > 220 || bytes.toString("base64") !== current.content.replace(/\s/g,""))
    throw Error("CURRENT_FILE_ENCODING_INVALID");
  return {pr,currentFile:bytes.toString("utf8"),fileBlobSha:current.sha,provenance:run};
}

/** Explicit caller-supplied immutable artifact. Always NOOP or one narrow GraphQL commit. */
export async function publishTrustedPilot({fetchImpl=fetch,token,event,receipt,source,dryRun=true,
  trustedMainSha,clock=Date.now}) {
  const current=await readTrustedState({fetchImpl,token,event});
  const plan=preparePublication({event,pr:current.pr,receipt,source,currentFile:current.currentFile});
  if(plan.action==="NOOP_ALREADY_FIXED")return {status:"ALREADY_FIXED",updated:false,head:plan.headSha};
  const mutation=buildCompareAndSwapMutation(plan);
  if(dryRun)return {status:"VALIDATED_DRY_RUN",updated:false,head:plan.headSha,branch:BRANCH};
  // Re-read the owner gate in this write job, after candidate/state reads.
  // A prior eligible preflight is not a reusable grant or a current clock.
  const approvals=await githubGet(fetchImpl,token,ROOT+"/repos/"+REPOSITORY+
    "/issues/1865/comments?per_page=100");
  if(!ownerApprovalForPublisher(approvals,{trustedMainSha,now:clock()}))
    throw Error("OWNER_ACTIVATION_APPROVAL_REQUIRED");
  // Exact GraphQL expectedHeadOid is the atomic head compare-and-swap. No push --force.
  const response=await fetchImpl(graphqlUrl,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(15_000),
    headers:{Authorization:"Bearer "+token,Accept:"application/json",
      "Content-Type":"application/json"},
    body:JSON.stringify(mutation),
  });
  if (!response.ok) throw Error("GITHUB_CAS_PUBLISH_FAILED_"+response.status);
  const result=await response.json();
  const commit=result?.data?.createCommitOnBranch?.commit?.oid;
  if (result?.errors?.length || !SHA.test(commit ?? ""))
    throw Error("GITHUB_CAS_REJECTED_OR_UNVERIFIED");
  return {status:"PUBLISHED",updated:true,head:plan.headSha,commit,branch:BRANCH};
}

if (process.argv[1]?.endsWith("/chat-actions-trusted-publisher.mjs")) {
  const env=process.env;
  // No publishing from an untrusted PR workflow. A trusted default-branch
  // workflow_run job must set the exact pilot flag deliberately.
  if (env.GITHUB_EVENT_NAME!=="workflow_run" ||
      env.GITHUB_REPOSITORY!==REPOSITORY ||
      !env.GITHUB_EVENT_PATH || !env.GITHUB_TOKEN ||
      !env.GORIQ_PILOT_RECEIPT || !env.GORIQ_PILOT_SOURCE)
    throw Error("TRUSTED_ACTIONS_CONTEXT_REQUIRED");
  const actualTrustedSha=execFileSync("git",["rev-parse","HEAD"],{
    encoding:"utf8",stdio:["ignore","pipe","ignore"],timeout:10000,
  }).trim();
  if(!SHA.test(env.GITHUB_SHA??"") || actualTrustedSha!==env.GITHUB_SHA)
    throw Error("TRUSTED_PUBLISHER_SOURCE_MISMATCH");
  const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,"utf8"));
  const receipt=JSON.parse(readFileSync(env.GORIQ_PILOT_RECEIPT,"utf8"));
  const source=readFileSync(env.GORIQ_PILOT_SOURCE,"utf8");
  // This explicit activation flag is only supplied by reviewed trusted main workflow code.
  const publish=env.GORIQ_PILOT_PUBLISH==="isolated-1865";
  const result=await publishTrustedPilot({token:env.GITHUB_TOKEN,event,receipt,source,dryRun:!publish,trustedMainSha:env.GITHUB_SHA});
  process.stdout.write(JSON.stringify(result)+"\n");
  if(env.GITHUB_STEP_SUMMARY) {
    const {appendFileSync}=await import("node:fs");
    appendFileSync(env.GITHUB_STEP_SUMMARY,
      "## Trusted Actions candidate publisher\nStatus: "+result.status+
      "\nPR: #"+PR+"\nNo production merge or deployment\n");
  }
}
