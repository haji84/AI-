// Real GitHub PR/AI09 evidence audit. Public GET only, no credentials, mutations or approval.
import { readFileSync } from "node:fs";
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const API = "https://api.github.com";
const MAX_COMMENTS = 100;
const HEADER = /^<!-- GORIQ_AI09_ADVISORY_V2 PR=(\d+) HEAD=([0-9a-f]{40}) BASE=([0-9a-f]{40}) -->/;

function validEvent(event, repository) {
  if (!event || !REPO.test(repository) || !["pull_request", "pull_request_target"].includes(event.eventName))
    throw Error("UNTRUSTED_EVENT_CONTEXT");
  const p = event.payload?.pull_request;
  const n = event.payload?.number;
  if (!p || !Number.isSafeInteger(n) || n < 1 ||
      p.number !== n || p.state !== "open" ||
      p.head?.repo?.full_name !== repository || p.base?.repo?.full_name !== repository ||
      p.base?.ref !== "main" || !SHA.test(p.head?.sha || "") ||
      !SHA.test(p.base?.sha || "")) throw Error("PR_CONTEXT_NOT_VERIFIED");
  return { prNumber:n, headSha:p.head.sha, baseSha:p.base.sha };
}
async function publicGetJson(fetchImpl, url, token) {
  const parsed = new URL(url);
  if (parsed.origin !== API || !/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:pulls\/\d+|issues\/\d+\/comments)$/.test(parsed.pathname))
    throw Error("API_URL_NOT_ALLOWED");
  const resp = await fetchImpl(parsed.toString(), {
    method:"GET", redirect:"error",
    headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
      ...(token ? {Authorization:"Bearer "+token} : {})},
    signal:AbortSignal.timeout(10_000),
  });
  if (!resp?.ok) throw Error("PUBLIC_GITHUB_READ_FAILED_"+(resp?.status??"UNKNOWN"));
  return resp.json();
}
/** Reads current real GitHub state; review remains advisory and never GitHub approval. */
export async function auditRealPr({event, repository, fetchImpl = fetch, token = null}) {
  const expected = validEvent(event, repository);
  const pr = await publicGetJson(fetchImpl,
    API+"/repos/"+repository+"/pulls/"+expected.prNumber,token);
  if (pr?.number !== expected.prNumber || pr?.state !== "open" ||
      pr?.head?.sha !== expected.headSha || pr?.base?.sha !== expected.baseSha ||
      pr?.head?.repo?.full_name !== repository || pr?.base?.repo?.full_name !== repository) {
    throw Error("STALE_OR_MISMATCHED_CURRENT_PR");
  }
  // Fetching a single bounded page deliberately reports INCOMPLETE if any more may exist.
  // Incomplete listing is never interpreted as "no review" or an approval.
  const comments = await publicGetJson(fetchImpl,
    API+"/repos/"+repository+"/issues/"+expected.prNumber+"/comments?per_page="+MAX_COMMENTS,token);
  if (!Array.isArray(comments) || comments.length > MAX_COMMENTS) throw Error("INVALID_COMMENT_PAGE");
  const incomplete = comments.length === MAX_COMMENTS;
  const receipts = comments.filter(c => c?.user?.login === "github-actions[bot]" && typeof c.body === "string")
    .map(c => ({match:c.body.match(HEADER),body:c.body}))
    .filter(r => r.match && Number(r.match[1]) === expected.prNumber &&
      r.match[2] === expected.headSha && r.match[3] === expected.baseSha &&
      r.body.includes("**Evidence class:** AI_ASSERTED") &&
      r.body.includes("**GitHub approval satisfied: NO**"));
  let ai09Status = "NO_CURRENT_HEAD_RECEIPT";
  if (receipts.length > 1) ai09Status = "MULTIPLE_RECEIPTS_REQUIRES_RECONCILIATION";
  else if (receipts.length === 1) {
    const status = receipts[0].body.match(/\*\*Status:\*\* (NO_ACTIONABLE_FINDINGS|CHANGES_REQUESTED|INCONCLUSIVE|BLOCKED)\b/);
    ai09Status = status ? status[1] : "INVALID_RECEIPT_STATUS";
  }
  if (incomplete) ai09Status = "INCOMPLETE_COMMENT_INVENTORY";
  const linkedIssue = typeof pr.body === "string"
    ? Number(pr.body.match(/\bRefs\s+#(\d+)\b/i)?.[1] || 0) : 0;
  // This is only a tentative same-issue reuse indication. Full PR inventory,
  // complete cross-PR deduplication and write locking remain separately required.
  const prReuseCandidate = linkedIssue > 0;
  return {
    evidenceClass:"MACHINE_OBSERVED_PUBLIC_GITHUB",
    workflowMode:"READ_ONLY",
    realGithubPrObserved:true,
    repository, prNumber:expected.prNumber,
    headSha:expected.headSha, baseSha:expected.baseSha,
    branch:pr.head.ref,
    prReuseCandidate,
    linkedIssue: linkedIssue || null,
    ai09Status, ai09IsFormalApproval:false,
    autoFixPerformed:false, autoMergeAuthorized:false,
    nextAction:ai09Status==="NO_ACTIONABLE_FINDINGS"
      ? "SEPARATE_INDEPENDENT_GATE_STILL_REQUIRED"
      : "VERIFY_CURRENT_HEAD_AI09_AND_REPAIR_BEFORE_INTEGRATION",
  };
}
if (process.argv[1]?.endsWith("/chat-actions-live-pr-audit.mjs")) {
  const path=process.env.GITHUB_EVENT_PATH;
  const repository=process.env.GITHUB_REPOSITORY;
  if (!path || !repository || process.env.GITHUB_EVENT_NAME!=="pull_request") throw Error("UNTRUSTED_HOST_ENVIRONMENT");
  const payload=JSON.parse(readFileSync(path,"utf8"));
  const result=await auditRealPr({event:{eventName:process.env.GITHUB_EVENT_NAME,payload},repository,
    token:process.env.GITHUB_TOKEN??null});
  process.stdout.write(JSON.stringify(result)+"\n");
  // Inability to fetch or stale/mismatched head fails the job. No advisory "no finding"
  // is ever promoted to a real formal review or merge decision.
}