import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source=readFileSync(".github/workflows/goriq-ai09-pr-review.yml","utf8");
function job(name,until) {
  const start=source.indexOf("\n  "+name+":\n");
  if(start<0)throw Error("missing_job_"+name);
  const end=until?source.indexOf("\n  "+until+":\n",start+1):source.length;
  if(end<0)throw Error("missing_successor_job");
  return source.slice(start,end);
}
test("review triggers only after CI completes and no root write rights",()=>{
 assert.match(source,/\non:\n\s+workflow_run:\n\s+workflows: \["CI"\]\n\s+types: \[completed\]/);
 assert.match(source,/\npermissions: \{\}/);
 assert.doesNotMatch(source,/pull_request_target|id-token:\s*write|contents:\s*write|pull-requests:\s*write|actions:\s*write/);
 assert.match(source,/cancel-in-progress:\s*true/);
});
test("preflight runs on GitHub, validates current CI/PR scope and never writes",()=>{
 const s=job("preflight","review");
 assert.match(s,/runs-on:\s*ubuntu-24\.04/);
 assert.match(s,/contents:\s*read/);
 assert.match(s,/pull-requests:\s*read/);
 assert.match(s,/ref:\s*main/);
 assert.match(s,/persist-credentials:\s*false/);
 assert.match(s,/node scripts\/goriq-ai09-preflight\.mjs/);
 assert.doesNotMatch(s,/issues:\s*write/);
});
test("model worker is ephemeral GitHub-hosted only, no portable PC or PR code",()=>{
 const s=job("review","comment");
 assert.match(s,/runs-on:\s*ubuntu-24\.04/);
 assert.doesNotMatch(s,/runs-on:\s*\[self-hosted|Verify owner-pinned ZBook runner name|RUNNER_NAME/);
 assert.match(s,/RUNNER_ENVIRONMENT.*github-hosted/);
 assert.match(s,/contents:\s*read/);
 assert.match(s,/pull-requests:\s*read/);
 assert.match(s,/ref:\s*\$\{\{ needs\.preflight\.outputs\.trusted_sha \}\}/);
 assert.match(s,/test "\$\(git rev-parse HEAD\)" = "\$TRUSTED_SHA"/);
 assert.match(s,/persist-credentials:\s*false/);
 assert.match(s,/node scripts\/goriq-ai09-ci-review\.mjs/);
 assert.doesNotMatch(s,/issues:\s*write|pull_request_target|ref:\s*\$\{\{\s*github\.event\.pull_request/);
});
test("Ollama is loopback, binary SHA256-pinned, and one free model",()=>{
 const s=job("review","comment");
 assert.match(s,/OLLAMA_HOST:\s*127\.0\.0\.1:11434/);
 assert.match(s,/sha256sum -c -/);
 assert.match(s,/v0\.34\.0\/ollama-linux-amd64\.tar\.zst/);
 assert.match(s,/timeout 480s ollama pull qwen2\.5-coder:3b/);
 assert.match(s,/OLLAMA_NUM_PARALLEL:\s*"1"/);
 assert.match(s,/OLLAMA_MAX_LOADED_MODELS:\s*"1"/);
 assert.match(s,/timeout-minutes:\s*50/);
});
test("hosted publisher alone may post comments with permission scoped to one job",()=>{
 const s=job("comment");
 assert.match(s,/runs-on:\s*ubuntu-24\.04/);
 assert.match(s,/needs\.review\.result == 'success'/);
 assert.match(s,/issues:\s*write/);
 assert.match(s,/contents:\s*read/);
 assert.match(s,/pull-requests:\s*read/);
 assert.match(s,/ref:\s*\$\{\{ needs\.preflight\.outputs\.trusted_sha \}\}/);
 assert.match(s,/node scripts\/goriq-ai09-post-review\.mjs/);
 assert.doesNotMatch(s,/contents:\s*write|pull-requests:\s*write|actions:\s*write/);
});
test("per-file model budget fits the bounded hosted worker timeout",()=>{
 const w=job("review","comment");
 const automation=readFileSync("src/orchestrator/ai09-pr-review-automation.mjs","utf8");
 const inference=readFileSync("scripts/goriq-ai09-ci-review.mjs","utf8");
 const minutes=Number(w.match(/timeout-minutes:\s*(\d+)/)?.[1]);
 const chunks=Number(automation.match(/const MAX_CHUNKS = (\d+);/)?.[1]);
 const slice=inference.split("async function localInfer(")[1]?.split("\nasync function main()")[0]||"";
 const ms=Number(slice.match(/AbortSignal\.timeout\((\d+)\)/)?.[1]);
 assert.ok(minutes>0 && chunks>0 && ms>0);
 assert.ok(minutes*60000>=chunks*ms+5*60000);
 assert.match(inference,/num_predict:\s*512/);
});
test("model worker and poster each reject incomplete GitHub patches",()=>{
 const worker=readFileSync("scripts/goriq-ai09-ci-review.mjs","utf8");
 const poster=readFileSync("scripts/goriq-ai09-post-review.mjs","utf8");
 for(const s of [worker,poster]){
  assert.match(s,/import \{ assertCompleteComparison \}/);
  assert.match(s,/assertCompleteComparison\(/);
 }
});
test("poster repeats deterministic credential-logging guard; 3B model only",()=>{
 const worker=readFileSync("scripts/goriq-ai09-ci-review.mjs","utf8");
 const poster=readFileSync("scripts/goriq-ai09-post-review.mjs","utf8");
 const local=readFileSync("scripts/goriq-ai09-review.mjs","utf8");
 assert.match(worker,/GORIQ_OLLAMA_MODEL\s*\|\|\s*"qwen2\.5-coder:3b"/);
 assert.match(local,/GORIQ_OLLAMA_MODEL\s*\?\?\s*"qwen2\.5-coder:3b"/);
 assert.match(poster,/hasAddedCredentialLogging\(trusted\.patch\)/);
 assert.match(poster,/reviewerResult\.status === "NO_ACTIONABLE_FINDINGS"/);
 assert.match(poster,/deterministic_sensitive_logging_risk/);
});
