#!/usr/bin/env node
// Reconcile an entire real GitHub PR against trusted AI09 limits, without writes.
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { planCompleteAi09Review } from "./chat-actions-ai09-multibatch.mjs";
import { validatePilotReviewEvent, PILOT_REVIEW_REPO, PILOT_PR_NUMBER } from "./chat-actions-ai09-chunk-retry.mjs";

const repoApi="https://api.github.com/repos/"+PILOT_REVIEW_REPO;
export async function trustedPlan({event,repository,token,trustedRoot,fetchImpl=fetch}) {
 const {headSha,mainSha}=validatePilotReviewEvent(event,repository);
 const actual=execFileSync("git",["rev-parse","HEAD"],{cwd:resolve(trustedRoot),encoding:"utf8"}).trim();
 if(mainSha!==actual)throw Error("AI09_TRUSTED_CODE_MISMATCH");
 const importTrusted=async p=>import(pathToFileURL(join(resolve(trustedRoot),p)).href);
 const [batches,coverage]=await Promise.all([
   importTrusted("src/orchestrator/ai09-pr-review-automation.mjs"),
   importTrusted("scripts/goriq-ai09-compare-coverage.mjs"),
 ]);
 const get=async path=>{
   const r=await fetchImpl(repoApi+path,{
     method:"GET",redirect:"error",signal:AbortSignal.timeout(15000),
     headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
       "X-GitHub-Api-Version":"2022-11-28"},
   });
   if(!r.ok)throw Error("GITHUB_READ_"+r.status);
   return r.json();
 };
 const p=await get("/pulls/"+PILOT_PR_NUMBER);
 if(p?.head?.sha!==headSha || p?.base?.sha!==mainSha ||
   p?.head?.repo?.full_name!==repository || p?.base?.repo?.full_name!==repository ||
   p?.state!=="open" || p?.number!==PILOT_PR_NUMBER)throw Error("PR_CHANGED_BEFORE_PLANNING");
 const compare=await get("/compare/"+mainSha+"..."+headSha);
 if(compare?.base_commit?.sha!==mainSha || compare?.commits?.at(-1)?.sha!==headSha)
   throw Error("COMPARISON_IDENTITY_MISMATCH");
 const plan=planCompleteAi09Review(compare,mainSha,headSha,{batches,coverage});
 // A manifest is only an integrity-bound itinerary. Reviewer findings belong
 // to independent AI09 jobs; no model authority is inherited from this step.
 const manifest={
   repository,pr:PILOT_PR_NUMBER,headSha,baseSha:mainSha,
   trustedSha:actual,patchSha256:plan.patchSha256,
   batchCount:plan.batchCount,totalChunks:plan.totalChunks,paths:plan.paths,
   batches:plan.batches.map(b=>({
     index:b.index,chunkCount:b.chunkCount,paths:b.paths,
     patchSha256:b.patchSha256,
   })),
   evidenceClass:"MACHINE_VERIFIED_PLAN",
   githubApprovalSatisfied:false,mergeAuthorized:false,
 };
 const manifestSha=createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
 return {plan,manifest:{...manifest,manifestSha}};
}
if(process.argv[1]?.endsWith("/chat-actions-ai09-full-plan.mjs")){
 const e=process.env;
 if(e.GITHUB_EVENT_NAME!=="pull_request"||e.GITHUB_REPOSITORY!==PILOT_REVIEW_REPO||
   !e.GITHUB_EVENT_PATH||!e.GITHUB_TOKEN||!e.GORIQ_AI09_TRUSTED_ROOT||
   !e.GITHUB_OUTPUT||!e.RUNNER_TEMP)throw Error("UNTRUSTED_FULL_PLAN_ENV");
 const event=JSON.parse(readFileSync(e.GITHUB_EVENT_PATH,"utf8"));
 const {manifest}=await trustedPlan({
   event,repository:e.GITHUB_REPOSITORY,token:e.GITHUB_TOKEN,
   trustedRoot:e.GORIQ_AI09_TRUSTED_ROOT,
 });
 const matrix=JSON.stringify({include:manifest.batches.map(b=>({batch:b.index}))});
 appendFileSync(e.GITHUB_OUTPUT,"matrix="+matrix+"\n");
 const path=resolve(e.RUNNER_TEMP,"chat-actions-ai09-full-plan.json");
 writeFileSync(path,JSON.stringify(manifest,null,2)+"\n",{flag:"w",mode:0o600});
 process.stdout.write("AI09_COMPLETE_PLAN="+JSON.stringify(manifest)+"\n");
}
