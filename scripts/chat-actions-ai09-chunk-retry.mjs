#!/usr/bin/env node
// Unprivileged AI09 recovery: actual trusted reviewer code, complete bounded GitHub diff chunks.
// No GitHub writes and no approval granted by any model response.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";

export const PILOT_REVIEW_REPO = "haji84/AI-";
export const PILOT_PR_NUMBER = 1866;
export const PILOT_BASE_SHA = "f81b7eb4f6025f05d6368a029aeca62bc86b876a";
const REVISION = /^[a-f0-9]{40}$/;
const ENDPOINT = "https://api.github.com/repos/" + PILOT_REVIEW_REPO;
const MODEL = "qwen2.5-coder:3b";

export function validatePilotReviewEvent(payload, repository) {
  const pr=payload?.pull_request;
  if (repository!==PILOT_REVIEW_REPO || payload?.number!==PILOT_PR_NUMBER ||
      pr?.number!==PILOT_PR_NUMBER || pr?.state!=="open" ||
      pr?.head?.repo?.full_name!==repository ||
      pr?.base?.repo?.full_name!==repository || pr?.base?.ref!=="main" ||
      pr?.head?.ref!=="codex/1865-pr-reuse-advisory" ||
      !REVISION.test(pr?.head?.sha??"") || !REVISION.test(pr?.base?.sha??""))
    throw Error("UNTRUSTED_PR_REVIEW_EVENT");
  return {headSha:pr.head.sha, mainSha:pr.base.sha};
}

async function readGitHubJson(url, token) {
  if (!url.startsWith(ENDPOINT+"/")) throw Error("UNEXPECTED_GITHUB_READ");
  const response=await fetch(url, {
    method:"GET", redirect:"error", signal:AbortSignal.timeout(15000),
    headers:{Accept:"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28",
      Authorization:"Bearer "+token},
  });
  if(!response.ok)throw Error("GITHUB_REVIEW_READ_"+response.status);
  return response.json();
}

export async function loadTrustedReviewModules(trustedRoot, trustedSha) {
  const root=resolve(trustedRoot);
  const actual=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  if (!REVISION.test(trustedSha)||actual!==trustedSha) throw Error("TRUSTED_REVIEWER_SHA_MISMATCH");
  const load=async p=>import(pathToFileURL(join(root,p)).href);
  const reviewer=await load("src/orchestrator/ai09-local-reviewer.mjs");
  const batches=await load("src/orchestrator/ai09-pr-review-automation.mjs");
  const coverage=await load("scripts/goriq-ai09-compare-coverage.mjs");
  const anchor=await load("scripts/goriq-ai09-finding-anchors.mjs");
  return {reviewer,batches,coverage,anchor};
}

/** Fails closed on oversized or incomplete comparisons. All chunks must be reviewed. */
export async function prepareBoundedReview(compare,headSha, modules) {
  if(compare?.base_commit?.sha!==PILOT_BASE_SHA ||
    compare?.commits?.at(-1)?.sha!==headSha)throw Error("REVIEW_COMPARISON_MISMATCH");
  modules.coverage.assertCompleteComparison(compare);
  const prepared=modules.batches.compareToReviewChunks(compare,PILOT_BASE_SHA,headSha);
  if (prepared.chunks.length>24 || prepared.chunks.some(x=>Buffer.byteLength(x.patch,"utf8")>4096))
    throw Error("UNBOUNDED_REVIEW_PATCH");
  return prepared;
}

export async function reviewWithLocalModel({prepared,headSha,modules,infer}) {
  const scope={baseSha:PILOT_BASE_SHA,headSha,paths:prepared.paths,
    patchSha256:prepared.patchSha256,reviewChunks:prepared.chunks.length};
  const reports=[];
  for(const chunk of prepared.chunks){
    const result=await modules.reviewer.reviewLocalPatch({
      baseSha:PILOT_BASE_SHA, headSha, makerRole:"FixtureBuilder",
      paths:chunk.paths, patch:chunk.patch, infer,
    });
    reports.push(result);
    process.stdout.write("AI09_CHUNK="+JSON.stringify({
      index:reports.length,total:prepared.chunks.length,
      size:Buffer.byteLength(chunk.patch,"utf8"),status:result.status})+"\n");
    if(result.status==="BLOCKED")break;
  }
  // Explicitly do not promote partial results or AI_ASSERTED into GitHub APPROVED.
  const consolidated=modules.batches.consolidateChunkReviews(reports,scope,prepared.chunks);
  return modules.anchor.holdUngroundedAdvisory(consolidated,prepared.patch);
}

// Ollama v0.34 supports native JSON-schema constrained generation. This
// constrains only serialization, never the AI09 security judgment or gates.
export const AI09_RESPONSE_SCHEMA = Object.freeze({
  type:"object",
  additionalProperties:false,
  properties:{
    verdict:{type:"string",enum:["NO_FINDINGS","CHANGES_REQUESTED","INCONCLUSIVE"]},
    findings:{
      type:"array",maxItems:20,
      items:{
        type:"object",additionalProperties:false,
        properties:{
          path:{type:"string"},
          line:{type:"integer",minimum:1},
          severity:{type:"string",enum:["low","medium","high","critical"]},
          summary:{type:"string"},
          evidence:{type:"string"},
          proposedFix:{type:"string"},
        },
        required:["path","line","severity","summary","evidence","proposedFix"],
      },
    },
  },
  required:["verdict","findings"],
});

// Diagnostics reveal ONLY a predefined failure category. Never log model
// source excerpts, prompts, findings, credentials or full invalid responses.
export function classifyAi09ResponseShape(content) {
  if(typeof content!=="string")return "MISSING_TEXT";
  if(Buffer.byteLength(content,"utf8")>20000)return "OVERSIZED_TEXT";
  let json;
  try{json=JSON.parse(content)}catch{return "INVALID_JSON";}
  if(!json || Array.isArray(json) || typeof json!=="object")return "NOT_OBJECT";
  if(!["NO_FINDINGS","CHANGES_REQUESTED","INCONCLUSIVE"].includes(json.verdict))
    return "INVALID_VERDICT";
  if(!Array.isArray(json.findings) || json.findings.length>20)
    return "INVALID_FINDINGS_ARRAY";
  if(json.verdict==="NO_FINDINGS" && json.findings.length!==0 ||
     json.verdict==="CHANGES_REQUESTED" && json.findings.length===0)
    return "VERDICT_FINDING_CONFLICT";
  for(const f of json.findings){
    if(!f || typeof f!=="object" || Array.isArray(f))return "INVALID_FINDING_OBJECT";
    if(typeof f.path!=="string" || !f.path || !Number.isInteger(f.line) || f.line<1)
      return "INVALID_FINDING_POSITION";
    if(!["low","medium","high","critical"].includes(f.severity))
      return "INVALID_FINDING_SEVERITY";
    if(["summary","evidence","proposedFix"].some(k=>typeof f[k]!=="string" || !f[k].trim()))
      return "INVALID_FINDING_FIELDS";
  }
  // Shape OK does not mean correct source line, verified consequence or approval.
  return "SHAPE_VALID_PENDING_TRUSTED_REVIEW";
}

export function buildAi09OllamaRequest(prompt) {
  if(typeof prompt!=="string" || prompt.length<1 || prompt.length>120000)
    throw Error("INVALID_AI09_MODEL_PROMPT");
  return {
    model:MODEL,stream:false,format:AI09_RESPONSE_SCHEMA,
    options:{temperature:0,num_ctx:8192,num_predict:1536},
    messages:[{role:"user",content:prompt}],
  };
}

export async function ollamaInference(prompt) {
  const start=performance.now();
  try {
    const response=await fetch("http://127.0.0.1:11434/api/chat",{
      method:"POST",signal:AbortSignal.timeout(150000),
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(buildAi09OllamaRequest(prompt)),
    });
    if(!response.ok)throw Error("MODEL_HTTP_"+response.status);
    const p=await response.json();
    const result=p?.message?.content;
    process.stdout.write("AI09_MODEL_METRIC="+JSON.stringify({
      elapsedMs:Math.round(performance.now()-start),
      promptTokens:Number.isSafeInteger(p.prompt_eval_count)?p.prompt_eval_count:null,
      outputTokens:Number.isSafeInteger(p.eval_count)?p.eval_count:null,
      outputBytes:typeof result==="string"?Buffer.byteLength(result,"utf8"):null,
      doneReason:["stop","length"].includes(p.done_reason)?p.done_reason:"unknown",
    })+"\n");
    process.stdout.write("AI09_MODEL_SHAPE="+JSON.stringify({
      classification:classifyAi09ResponseShape(result),
    })+"\n");
    if(p.done_reason==="length")throw Error("MODEL_RESPONSE_TRUNCATED");
    if(typeof result!=="string")throw Error("MODEL_RESPONSE_MISSING");
    return result;
  }catch(e){
    process.stdout.write("AI09_MODEL_FAILURE="+JSON.stringify({
      kind:e?.name==="TimeoutError"?"TIMEOUT":"RESPONSE_OR_RUNTIME_INVALID",
      elapsedMs:Math.round(performance.now()-start)})+"\n");
    throw e;
  }
}

if(process.argv[1]?.endsWith("/chat-actions-ai09-chunk-retry.mjs")){
  const env=process.env;
  if(env.GITHUB_EVENT_NAME!=="pull_request" ||
    env.GITHUB_REPOSITORY!==PILOT_REVIEW_REPO || !env.GITHUB_EVENT_PATH ||
    !env.GITHUB_TOKEN || !env.GORIQ_AI09_TRUSTED_ROOT ||
    !env.GORIQ_AI09_REPORT_FILE)throw Error("TRUSTED_REVIEW_CONTEXT_MISSING");
  const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,"utf8"));
  const {headSha,mainSha}=validatePilotReviewEvent(event,PILOT_REVIEW_REPO);
  const modules=await loadTrustedReviewModules(env.GORIQ_AI09_TRUSTED_ROOT,mainSha);
  const before=await readGitHubJson(ENDPOINT+"/pulls/"+PILOT_PR_NUMBER,env.GITHUB_TOKEN);
  if(before?.head?.sha!==headSha || before?.base?.sha!==mainSha || before?.state!=="open")
    throw Error("REVIEW_HEAD_STALE_BEFORE");
  const compare=await readGitHubJson(ENDPOINT+"/compare/"+PILOT_BASE_SHA+"..."+headSha,env.GITHUB_TOKEN);
  const prepared=await prepareBoundedReview(compare,headSha,modules);
  const verdict=await reviewWithLocalModel({prepared,headSha,modules,infer:ollamaInference});
  const after=await readGitHubJson(ENDPOINT+"/pulls/"+PILOT_PR_NUMBER,env.GITHUB_TOKEN);
  if(after?.head?.sha!==headSha || after?.base?.sha!==mainSha || after?.state!=="open")
    throw Error("REVIEW_HEAD_STALE_AFTER");
  const report={headSha,baseSha:PILOT_BASE_SHA,mainSha,reviewChunks:prepared.chunks.length,
    status:verdict.status,blockers:verdict.blockers,findings:verdict.findings,
    patchSha256:prepared.patchSha256,evidenceClass:"AI_ASSERTED",
    githubApprovalSatisfied:false,mergeAuthorized:false};
  writeFileSync(env.GORIQ_AI09_REPORT_FILE,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  process.stdout.write("AI09_FINAL_RESULT="+JSON.stringify(report)+"\n");
  if(verdict.status!=="NO_ACTIONABLE_FINDINGS")process.exitCode=2;
}
