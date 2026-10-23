#!/usr/bin/env node
// Fail-closed independent full-PR AI09 aggregator. All batches required, no merge power.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { trustedPlan } from "./chat-actions-ai09-full-plan.mjs";
import { collectAi09Evidence } from "./chat-actions-ai09-multibatch.mjs";
import { loadTrustedReviewModules,
  PILOT_REVIEW_REPO } from "./chat-actions-ai09-chunk-retry.mjs";

export function aggregateIndependentBatchReceipts({plan,manifest,receipts,modules}) {
  if(!Array.isArray(receipts) || !Array.isArray(plan?.batches) ||
     manifest?.headSha!==plan.headSha || manifest?.baseSha!==plan.baseSha ||
     manifest?.patchSha256!==plan.patchSha256 ||
     manifest?.batchCount!==plan.batchCount ||
     manifest?.batches?.length!==plan.batchCount)
    throw Error("FULL_REVIEW_MANIFEST_INVALID");
  const seen=new Set(), ready=[];
  let malformed=0;
  for(const x of receipts) {
    const batch=plan.batches[x?.index];
    const recognized=x?.schema===1 && Number.isSafeInteger(x.index) &&
      x.index>=0 && x.index<plan.batchCount && !seen.has(x.index) &&
      batch?.patchSha256===x.patchSha256 &&
      x.manifestSha===manifest.manifestSha &&
      x.baseSha===plan.baseSha && x.headSha===plan.headSha &&
      x.expectedChunks===batch.chunkCount &&
      x.reviewedChunks===x.chunkReports?.length &&
      x.evidenceClass==="AI_ASSERTED" &&
      x.githubApprovalSatisfied===false && x.mergeAuthorized===false &&
      Array.isArray(x.chunkReports);
    if(!recognized) {malformed++;continue}
    seen.add(x.index);
    ready.push({index:x.index,patchSha256:x.patchSha256,chunkReports:x.chunkReports});
  }
  const composite=collectAi09Evidence(plan,ready,modules);
  const status=malformed ? "BLOCKED" : composite.status;
  const missing=plan.batches.filter(b=>!seen.has(b.index)).map(b=>b.index);
  const {unresolvedFindings,observations,...rest}=composite;
  const summary={
    ...rest,status,manifestSha:manifest.manifestSha,headSha:plan.headSha,
    baseSha:plan.baseSha,reviewedBatchCount:ready.length,
    expectedBatchCount:plan.batchCount,missingBatchIndexes:missing,
    invalidReceiptCount:malformed,observations,
    // Earlier AI09 model findings persist even if a later batch is blocked.
    // They remain AI_ASSERTED, not automatically confirmed vulnerabilities.
    unresolvedFindings,
    acceptedReview:status==="NO_ACTIONABLE_FINDINGS" && missing.length===0 &&
      malformed===0 && composite.receivedBatches===plan.batchCount,
    evidenceClass:"AI_ASSERTED",
    githubApprovalSatisfied:false,mergeAuthorized:false,
  };
  if(!summary.acceptedReview && summary.status==="NO_ACTIONABLE_FINDINGS")
    summary.status="BLOCKED";
  return summary;
}

if(process.argv[1]?.endsWith("/chat-actions-ai09-full-aggregate.mjs")){
  const e=process.env;
  if(e.GITHUB_EVENT_NAME!=="pull_request" ||
     e.GITHUB_REPOSITORY!==PILOT_REVIEW_REPO ||
     !e.GITHUB_EVENT_PATH || !e.GITHUB_TOKEN ||
     !e.GORIQ_AI09_TRUSTED_ROOT || !e.GORIQ_AI09_BATCH_DIR ||
     !e.RUNNER_TEMP)throw Error("UNTRUSTED_AGGREGATE_ENV");
  const event=JSON.parse(readFileSync(e.GITHUB_EVENT_PATH,"utf8"));
  const {plan,manifest}=await trustedPlan({
    event,repository:e.GITHUB_REPOSITORY,token:e.GITHUB_TOKEN,
    trustedRoot:e.GORIQ_AI09_TRUSTED_ROOT,
  });
  const modules=await loadTrustedReviewModules(
    e.GORIQ_AI09_TRUSTED_ROOT,manifest.trustedSha);
  const dir=resolve(e.GORIQ_AI09_BATCH_DIR);
  const entries=readdirSync(dir).filter(x=>/^ai09-batch-\d+\.json$/.test(x));
  // Never follow arbitrary payload paths or accept silent extra files.
  if(entries.length>30)throw Error("UNBOUNDED_BATCH_RECEIPT_SET");
  const receipts=entries.map(x=>{
    const content=readFileSync(join(dir,x),"utf8");
    if(content.length>2_000_000)throw Error("OVERSIZED_BATCH_RECEIPT");
    return JSON.parse(content);
  });
  const result=aggregateIndependentBatchReceipts({
    plan,manifest,receipts,modules,
  });
  const location=resolve(e.RUNNER_TEMP,"ai09-full-review.json");
  writeFileSync(location,JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
  process.stdout.write("AI09_ALL_PR_VERDICT="+JSON.stringify({
    status:result.status,complete:result.acceptedReview,
    requiredBatches:result.expectedBatchCount,gotBatches:result.reviewedBatchCount,
    missing:result.missingBatchIndexes,invalid:result.invalidReceiptCount,
    totalChunks:result.totalChunks,modelFindings:result.unresolvedFindings.length,
    headSha:result.headSha,patchSha256:result.patchSha256,
    githubApprovalSatisfied:false,mergeAuthorized:false,
  })+"\n");
  if(!result.acceptedReview)process.exitCode=2;
}
