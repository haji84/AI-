#!/usr/bin/env node
// Owner-side, read-only AI-09 review of PR 1819. No model install, CodeRabbit,
// GitHub write, Builder call, worktree mutation, merge, or authority claim.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
const REPO="haji84/AI-", PR=1819;
const BASE="cb6b0fa06492b3d610ecb527645244b9a46ba8eb";
const HEAD="a63273495091f4c4f57e1fb1ed3576dc6dee0c9d";
const CI=38997315712, HOST="http://127.0.0.1:11434";
const s={pr:PR,baseSha:BASE,headSha:HEAD,ciRunId:CI,model:null,totalChunks:null,
  reviewedChunks:0,completeCoverage:false,patchSha256:null,reviewStatus:"BLOCKED",
  blockers:[],chunkResults:[],findings:[],evidenceClass:"AI_ASSERTED",
  githubApprovalSatisfied:false,mergeAuthorized:false,codeBuilderCalled:false};
const t0=performance.now();
function reject(code){throw Error(code);}
async function json(url, options={}) {
  const r=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(options.timeout||20000),
    headers:options.body?{"Content-Type":"application/json"}:
      {Accept:"application/vnd.github+json","User-Agent":"GORIQ-AI09-owner-readonly"},
    method:options.body?"POST":"GET",body:options.body?JSON.stringify(options.body):undefined});
  if(!r.ok)reject("HTTP_UNAVAILABLE");
  const body=await r.text();if(body.length>2000000)reject("UNBOUNDED_REPLY");
  return JSON.parse(body);
}
async function review(){
  if(process.argv.length!==3||!process.argv[2])reject("WORKTREE_ARGUMENT_REQUIRED");
  const root=resolve(process.argv[2]);
  const paths=["src/orchestrator/ai09-local-reviewer.mjs",
    "src/orchestrator/ai09-pr-review-automation.mjs",
    "scripts/goriq-ai09-compare-coverage.mjs",
    "scripts/goriq-ai09-finding-anchors.mjs"];
  for(const p of paths)if(!existsSync(join(root,p)))reject("TRUSTED_REVIEWER_SOURCE_MISSING");
  const git=(args)=>execFileSync("git",["-C",root,...args],
    {encoding:"utf8",windowsHide:true,timeout:10000,stdio:["ignore","pipe","ignore"]}).trim();
  if(git(["rev-parse","HEAD"])!==BASE)reject("TRUSTED_BASE_SHA_MISMATCH");
  if(git(["status","--porcelain=v1","--",...paths]))reject("REVIEWER_SOURCE_DIRTY");
  const [{reviewLocalPatch},{compareToReviewChunks,consolidateChunkReviews},
    {assertCompleteComparison},{holdUngroundedAdvisory}]=await Promise.all(paths.map(p=>
      import(pathToFileURL(join(root,p)).href)));
  const tags=await json(HOST+"/api/tags",{timeout:5000});
  const installed=new Set((tags.models||[]).map(x=>x.name));
  const choice=["qwen2.5-coder:3b","qwen3:4b","qwen2.5-coder:1.5b","qwen2.5-coder:7b"]
    .find(m=>installed.has(m));
  if(!choice)reject("LOCAL_OLLAMA_MODEL_NOT_INSTALLED");
  s.model=choice;
  const api="https://api.github.com/repos/"+REPO;
  const pr=await json(api+"/pulls/"+PR);
  if(pr.state!=="open"||pr.head?.sha!==HEAD||pr.base?.sha!==BASE||
    pr.head?.repo?.full_name!==REPO||pr.base?.repo?.full_name!==REPO)
    reject("PR_HEAD_OR_BASE_CHANGED");
  const ci=await json(api+"/actions/runs/"+CI);
  if(ci.id!==CI||ci.head_sha!==HEAD||ci.status!=="completed"||
    ci.conclusion!=="success")reject("CI_RECEIPT_INVALID");
  const cmp=await json(api+"/compare/"+BASE+"..."+HEAD);
  if(cmp.base_commit?.sha!==BASE||cmp.commits?.at(-1)?.sha!==HEAD)
    reject("COMPARE_REVISION_INVALID");
  assertCompleteComparison(cmp);
  const prepared=compareToReviewChunks(cmp,BASE,HEAD);
  s.totalChunks=prepared.chunks.length;
  s.patchSha256=prepared.patchSha256;
  const reports=[];
  // Keep all five chunks observable even when one inference cannot be parsed.
  // A blocked chunk is NEVER counted as valid coverage or a clean review.
  for(const [index,chunk] of prepared.chunks.entries()){
    const start=performance.now();
    let metric={doneReason:"unavailable",promptTokens:null,outputTokens:null,
      failureClass:"UNKNOWN"};
    const result=await reviewLocalPatch({
      baseSha:BASE,headSha:HEAD,makerRole:"Builder",
      paths:chunk.paths,patch:chunk.patch,
      infer:async(prompt)=>{
        // Large, repetitive JSON findings can exceed num_predict and truncate
        // the only valid response. Ask for few, exact, line-grounded findings.
        const scopedPrompt="Report no more than TWO distinct, verifiable issues. "+
          "Each finding must cite the exact changed line and quote the actual "+
          "added code. Test-only dummy values and documentation prose are not "+
          "secret disclosures or executable access-control bypasses. "+
          "Return INCONCLUSIVE when evidence is missing.\\n"+prompt;
        try {
          const ans=await json(HOST+"/api/chat",{timeout:120000,
            body:{model:choice,stream:false,format:"json",
              options:{temperature:0,num_ctx:8192,num_predict:1536},
              messages:[{role:"user",content:scopedPrompt}]}});
          const output=ans.message?.content;
          metric={doneReason:["stop","length"].includes(ans.done_reason)?
            ans.done_reason:"unknown",
            promptTokens:Number.isSafeInteger(ans.prompt_eval_count)?
              ans.prompt_eval_count:null,
            outputTokens:Number.isSafeInteger(ans.eval_count)?
              ans.eval_count:null,
            failureClass:"NONE"};
          if(typeof output!=="string"||output.length>20000)
            reject("MODEL_RESPONSE_INVALID");
          return output;
        } catch(e) {
          metric.failureClass=e?.name==="TimeoutError"?"TIMEOUT":
            (e?.message==="MODEL_RESPONSE_INVALID"?"MODEL_RESPONSE_INVALID":
              e?.message==="HTTP_UNAVAILABLE"?"HTTP_UNAVAILABLE":"INFERENCE_ERROR");
          throw e;
        }
      }});
    reports.push(result);
    s.reviewedChunks++;
    s.chunkResults.push({chunk:index+1,status:result.status,
      durationMs:Math.round(performance.now()-start),
      bytes:Buffer.byteLength(chunk.patch,"utf8"),
      findings:result.findings?.length||0,
      doneReason:metric.doneReason,
      promptTokens:metric.promptTokens,
      outputTokens:metric.outputTokens,
      failureClass:result.status==="BLOCKED"&&metric.failureClass==="NONE"?
        "MODEL_JSON_OR_CONTRACT_INVALID":metric.failureClass});
  }
  const scope={baseSha:BASE,headSha:HEAD,paths:prepared.paths,
    patchSha256:prepared.patchSha256,reviewChunks:prepared.chunks.length};
  const verdict=holdUngroundedAdvisory(
    consolidateChunkReviews(reports,scope,prepared.chunks),prepared.patch);
  s.reviewStatus=verdict.status;
  s.blockers=(verdict.blockers||[]).filter(x=>/^[a-z_]+$/.test(x));
  s.findings=(verdict.findings||[]).map(x=>({path:x.path,line:x.line,
    severity:x.severity,summary:x.summary,evidence:x.evidence}));
  s.allChunksAttempted=reports.length===prepared.chunks.length;
  s.completeCoverage=s.allChunksAttempted &&
    reports.every(r=>r.status!=="BLOCKED");
  const last=await json(api+"/pulls/"+PR);
  if(last.head?.sha!==HEAD||last.base?.sha!==BASE)reject("PR_CHANGED_DURING_REVIEW");
}
try{await review();}
catch(e){s.reviewStatus="BLOCKED";s.blockers.push(/^[A-Z0-9_]+$/.test(e.message)?
  e.message:"REVIEW_EXECUTION_FAILED");}
s.elapsedMs=Math.round(performance.now()-t0);
s.advisoryPassOnly=s.completeCoverage&&s.reviewStatus==="NO_ACTIONABLE_FINDINGS"&&
  s.blockers.length===0;
try{writeFileSync(join(tmpdir(),"goriq-ai09-1819-"+randomUUID()+".json"),
  JSON.stringify(s,null,2)+"\n",{mode:0o600,flag:"wx"});s.tempReceiptSaved=true;}
catch{s.tempReceiptSaved=false;}
console.log(JSON.stringify(s,null,2));
if(!s.advisoryPassOnly)process.exitCode=2;
