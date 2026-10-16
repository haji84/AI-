import { holdUngroundedAdvisory } from "./goriq-ai09-finding-anchors.mjs";
#!/usr/bin/env node
// GORIQ AI-09 independent technical advisory for RACE AI.
// Read-only: the only network destinations are the public GitHub API and loopback Ollama.
// It does not post comments, change repository settings, merge, or claim approvals.
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { reviewLocalPatch } from "../src/orchestrator/ai09-local-reviewer.mjs";
import { assertCompleteComparison } from "./goriq-ai09-compare-coverage.mjs";
import { compareToReviewChunks, consolidateChunkReviews } from "../src/orchestrator/ai09-pr-review-automation.mjs";

const REPO = "haji84/RACE-AI";
const SHA40 = /^[a-f0-9]{40}$/;
const REQUIRED_CHECKS = ["unit (windows-latest)", "unit (ubuntu-latest)", "pilot"];

function assertPr(pr, number, head, base) {
  if (!Number.isSafeInteger(number) || number < 1 || !SHA40.test(head) || !SHA40.test(base) ||
      head === base || pr?.number !== number || pr?.state !== "open" ||
      pr.head?.sha !== head || pr.base?.sha !== base ||
      pr.head?.repo?.full_name !== REPO || pr.base?.repo?.full_name !== REPO ||
      pr.head.repo.id !== pr.base.repo.id) throw Error("RACE_PR_HEAD_OR_ORIGIN_CHANGED");
}

export function requireRaceChecks(checks, head) {
  if (!Array.isArray(checks) || !SHA40.test(head)) throw Error("RACE_CI_EVIDENCE_INVALID");
  for (const name of REQUIRED_CHECKS) {
    const matching = checks.filter(x => x?.name === name && x.head_sha === head &&
      x.app?.slug === "github-actions");
    if (matching.length !== 1 || matching[0].status !== "completed" ||
        matching[0].conclusion !== "success") throw Error("RACE_CI_NOT_VERIFIED_" + name);
  }
}

export function assessFindingAnchors(compare, findings) {
  if (!Array.isArray(compare?.files) || !Array.isArray(findings)) throw Error("INVALID_GROUNDING_INPUT");
  const changed = new Map();
  for (const file of compare.files) {
    if (!file || typeof file.filename !== "string" || typeof file.patch !== "string") {
      throw Error("INVALID_GROUNDING_FILE");
    }
    const lines = new Map();
    let nextLine = null;
    for (const line of file.patch.split("\n")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {nextLine=Number(hunk[1]);continue;}
      if (nextLine === null)continue;
      if (line.startsWith("+")) {lines.set(nextLine,line.slice(1));nextLine++;}
      else if (line.startsWith(" "))nextLine++;
      else if (line.startsWith("-") || line.startsWith("\\"))continue;
      else throw Error("INVALID_GROUNDING_HUNK");
    }
    changed.set(file.filename, lines);
  }
  return findings.map(finding => {
    const changedLines = changed.get(finding.path);
    let status = "UNVERIFIED";
    if (!changedLines)status="INVALID_PATH";
    else if (!Number.isSafeInteger(finding.line) || !changedLines.has(finding.line)) status="INVALID_CHANGED_LINE";
    else {
      // A purported vulnerability is not grounded just because the file exists.
      // Match a meaningful literal from the actual ADDED code; source patch is
      // trusted GitHub diff input while model claims are untrusted suggestions.
      const line=changedLines.get(finding.line).trim();
      const evidence=typeof finding.evidence === "string" ? finding.evidence : "";
      const fragments=line.match(/[\w.$()[\]{}=;:,+*-]{12,}/g)||[];
      if (fragments.some(part=>evidence.includes(part))) status="CODE_QUOTE_MATCHED";
      else status="MISSING_CODE_QUOTE";
    }
    return {path:finding.path,line:finding.line??null,status,
      machineGrounded:status==="CODE_QUOTE_MATCHED",
      issueConfirmed:false};
  });
}

export async function reviewRacePull({number,head,base,api,infer}) {
  if (!Number.isSafeInteger(number) || number < 1 || !SHA40.test(head) ||
      !SHA40.test(base) || head === base || typeof api !== "function" ||
      typeof infer !== "function") throw Error("INVALID_REVIEW_REQUEST");
  const first = await api("/pulls/" + number);
  assertPr(first, number, head, base);
  const checks = await api("/commits/" + head + "/check-runs?per_page=100");
  if (!Number.isSafeInteger(checks?.total_count) || checks.total_count > 100 ||
      !Array.isArray(checks.check_runs) || checks.total_count !== checks.check_runs.length)
    throw Error("RACE_CHECKS_PAGINATION_INCOMPLETE");
  requireRaceChecks(checks.check_runs, head);
  const compare = await api("/compare/" + base + "..." + head);
  if (compare?.base_commit?.sha !== base || compare?.commits?.at(-1)?.sha !== head)
    throw Error("RACE_COMPARE_REVISION_CHANGED");
  assertCompleteComparison(compare);
  const prepared = compareToReviewChunks(compare, base, head);
  const scope = {baseSha:base,headSha:head,paths:prepared.paths,
    patchSha256:prepared.patchSha256,reviewChunks:prepared.chunks.length};
  const reports = [];
  const chunkOutcomes = [];
  for(const chunk of prepared.chunks) {
    const started = performance.now();
    const report = await reviewLocalPatch({
      baseSha:base,headSha:head,makerRole:"Builder",
      paths:chunk.paths,patch:chunk.patch,infer
    });
    reports.push(report);
    chunkOutcomes.push({
      sequence:chunkOutcomes.length+1,
      bytes:Buffer.byteLength(chunk.patch,"utf8"),
      durationMs:Math.round(performance.now()-started),
      status:report.status,
      blocker:report.blockers.length === 1 && /^[a-z_]+$/.test(report.blockers[0]) ? report.blockers[0] : "none"
    });
    if(report.status === "BLOCKED")break;
  }
  const result = holdUngroundedAdvisory(consolidateChunkReviews(reports,scope,prepared.chunks), prepared.patch);
  const findingGrounding=assessFindingAnchors(compare,result.findings);
  const second=await api("/pulls/"+number);
  assertPr(second,number,head,base);
  if (result.status === "NO_ACTIONABLE_FINDINGS" &&
      !reports.every(x => x.status === "NO_ACTIONABLE_FINDINGS"))
    throw Error("UNTRUSTED_CLEAN_RESULT");
  return {
    schemaVersion:1,repository:REPO,prNumber:number,headSha:head,baseSha:base,
    reviewer:"AI-09",reviewerRole:"separate_advisory",
    status:result.status,findings:result.findings,blockers:result.blockers,
    patchSha256:prepared.patchSha256,
    reviewedPaths:prepared.paths,chunkCount:prepared.chunks.length,
    findingGrounding,
    chunkOutcomes,
    modelProvider:"loopback-only",evidenceClass:"AI_ASSERTED",
    physicalEvidenceVerified:false,githubApprovalSatisfied:false,
    independentGitHubAccountVerified:false,mergeAuthorized:false,
    correctionHandoff:result.status === "CHANGES_REQUESTED" ?
      {taskId:"ai09:race:"+number+":"+head,target:"Builder/Debugger",
       actualTaskAcknowledged:false,allowedToWrite:false} : null
  };
}


const SAFE_LEAK = /(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:authorization|api[_ -]?key|secret|password|access[_ -]?token)\s*[:=]\s*[^\s,;]{8,})/i;
function safeFindingText(value, max) {
  // The advisory is untrusted model data, never authority. Unpublishable
  // fields are replaced wholesale rather than allowing any guessed secret
  // to escape into public CI logs or artifacts.
  const REDACTED = "[REDACTED_UNSAFE_AI09_TEXT]";
  if (typeof value !== "string" || !value.trim() || value.length > max) return REDACTED;
  const hasBadControl=[...value].some(c => {
    const n=c.charCodeAt(0);
    return (n < 32 && ![9,10,13].includes(n)) || n === 127;
  });
  if (hasBadControl || SAFE_LEAK.test(value)) return REDACTED;
  return value.replace(/[\r\n\t]/g," ").replace(/@/g,"@\u200b")
    .replace(/</g,"&lt;").replace(/>/g,"&gt;").trim();
}
export function safeRaceFindingSummaries(review) {
  if (!review || review.schemaVersion !== 1 ||
      review.repository !== REPO || review.reviewer !== "AI-09" ||
      review.evidenceClass !== "AI_ASSERTED" ||
      review.githubApprovalSatisfied !== false || review.mergeAuthorized !== false ||
      review.independentGitHubAccountVerified !== false ||
      !SHA40.test(review.headSha ?? "") || !SHA40.test(review.baseSha ?? "") ||
      !Array.isArray(review.reviewedPaths) || !Array.isArray(review.findings) ||
      !Array.isArray(review.chunkOutcomes) || !Number.isSafeInteger(review.chunkCount) ||
      !Array.isArray(review.findingGrounding) || review.findingGrounding.length !== review.findings.length ||
      review.findings.length > 20 || review.chunkOutcomes?.length !== review.chunkCount ||
      !review.chunkOutcomes.every((c,i)=>c.sequence === i+1 &&
        ["NO_ACTIONABLE_FINDINGS","CHANGES_REQUESTED","INCONCLUSIVE"].includes(c.status)) ||
      !["NO_ACTIONABLE_FINDINGS","CHANGES_REQUESTED","INCONCLUSIVE"].includes(review.status)) {
    throw Error("INCOMPLETE_OR_UNTRUSTED_AI09_FINDINGS");
  }
  return review.findings.map((f,index) => {
    const grounding=review.findingGrounding[index];
    if (!grounding || grounding.path !== f.path || grounding.line !== (f.line??null) ||
        !["CODE_QUOTE_MATCHED","MISSING_CODE_QUOTE","INVALID_CHANGED_LINE","INVALID_PATH"].includes(grounding.status) ||
        grounding.issueConfirmed !== false || grounding.machineGrounded !== (grounding.status === "CODE_QUOTE_MATCHED")) {
      throw Error("INVALID_GROUNDING_RECEIPT");
    }
    if (!review.reviewedPaths.includes(f.path) || !["low","medium","high","critical"].includes(f.severity) ||
        (f.line != null && (!Number.isSafeInteger(f.line) || f.line < 1 || f.line > 500000))) {
      throw Error("INVALID_AI09_FINDING_SCOPE");
    }
    return {
      headSha:review.headSha,
      path:safeFindingText(f.path,250),
      line:f.line??null,
      severity:f.severity,
      summary:safeFindingText(f.summary,500),
      evidence:safeFindingText(f.evidence,800),
      proposedFix:safeFindingText(f.proposedFix,800),
      evidenceClass:"AI_ASSERTED",
      evidenceAnchorStatus:grounding.status,
      machineGrounded:grounding.machineGrounded,
      issueConfirmed:false,
      githubApprovalSatisfied:false,
      mergeAuthorized:false
    };
  });
}

export function parseRaceRequest(args, loadManifest = path => JSON.parse(readFileSync(path,"utf8"))) {
  if(args.length === 2 && args[0] === "--manifest") {
    const manifest=loadManifest(args[1]);
    if (manifest?.schemaVersion !== 1 ||
      manifest.contract !== "GORIQ_AI09_ADVISORY_REQUEST_V1" ||
      manifest.repository !== REPO || manifest.recipient !== "GORIQ/AI-09" ||
      typeof manifest.ciReady !== "boolean" || manifest.githubApprovalSatisfied !== false ||
      manifest.mergeAuthorized !== false || manifest.gitHubWritePerformed !== false ||
      manifest.reviewerMustDifferFromBuilder !== true ||
      !((manifest.ciReady === true && manifest.nextAction === "REQUEST_AI09") ||
        (manifest.ciReady === false && manifest.nextAction === "WAIT_FOR_EXACT_HEAD_CI"))) throw Error("UNTRUSTED_RACE_MANIFEST");
    const {prNumber:number,headSha:head,baseSha:base}=manifest;
    if (!Number.isSafeInteger(number) || number < 1 || !SHA40.test(head) ||
      !SHA40.test(base) || head === base) throw Error("INVALID_MANIFEST_SCOPE");
    return {number,head,base};
  }
  if(args.length !== 6 || args[0] !== "--pr" || args[2] !== "--head" || args[4] !== "--base")
    throw Error("USAGE: --manifest PATH | --pr NUMBER --head FULL_SHA --base FULL_SHA");
  const number=Number(args[1]),head=args[3],base=args[5];
  if(!Number.isSafeInteger(number) || number <= 0 || !SHA40.test(head) || !SHA40.test(base))
    throw Error("INVALID_EXACT_REVIEW_SCOPE");
  return {number,head,base};
}
async function main() {
  const {number,head,base}=parseRaceRequest(process.argv.slice(2));
  async function api(path) {
    const url="https://api.github.com/repos/"+REPO+path;
    const headers={"Accept":"application/vnd.github+json","User-Agent":"GORIQ-AI09-readonly"};
    // The ephemeral runner receives only this repository's read-only GitHub token.
    // Never put the token, headers, or any credentials into localInfer/prompts.
    if(process.env.GITHUB_TOKEN)headers.Authorization="Bearer "+process.env.GITHUB_TOKEN;
    const response=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error("RACE_GITHUB_GET_FAILED_"+response.status);
    return response.json();
  }
  const infer=async prompt => {
    // No PR code execution, credentials, network model endpoint, paid provider or fallback.
    const response=await fetch("http://127.0.0.1:11434/api/chat",{
      method:"POST",headers:{"Content-Type":"application/json"},
      signal:AbortSignal.timeout(150000),
      body:JSON.stringify({model:"qwen2.5-coder:3b",stream:false,format:"json",
        options:{temperature:0,num_ctx:8192,num_predict:768},messages:[{role:"user",content:prompt}]})
    });
    if(!response.ok){
      console.error("AI09_MODEL_HTTP_STATUS="+response.status);
      throw Error("LOCAL_MODEL_UNAVAILABLE");
    }
    const payload=await response.json();
    const content=payload?.message?.content;
    let parsed=null;
    try { parsed=JSON.parse(content); } catch { /* no model text is logged */ }
    const safeVerdict=["NO_FINDINGS","CHANGES_REQUESTED","INCONCLUSIVE"].includes(parsed?.verdict) ? parsed.verdict : "INVALID";
    console.error("AI09_MODEL_OUTPUT_METRICS="+JSON.stringify({
      doneReason:["stop","length"].includes(payload?.done_reason) ? payload.done_reason : "unknown",
      promptTokens:Number.isSafeInteger(payload?.prompt_eval_count)?payload.prompt_eval_count:null,
      outputTokens:Number.isSafeInteger(payload?.eval_count)?payload.eval_count:null,
      responseBytes:typeof content==="string"?Buffer.byteLength(content,"utf8"):0,
      parsedAsJson:!!parsed, safeVerdict,
      findingsCount:Array.isArray(parsed?.findings)?parsed.findings.length:null
    }));
    return content;
  };
  const review=await reviewRacePull({number,head,base,api,infer});
  // Findings are advisory. Never turn them into a GitHub APPROVED review.
  process.stdout.write(JSON.stringify(review,null,2)+"\n");
  if (review.status !== "NO_ACTIONABLE_FINDINGS")process.exitCode=2;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{process.stderr.write("AI09_RACE_REVIEW_HOLD: "+e.message+"\n");process.exitCode=2;});
