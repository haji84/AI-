// Read-only hosted non-Codex AI builder. Returns one bounded candidate, never pushes.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const HOST = "http://127.0.0.1:11434";
const MODEL = "qwen2.5-coder:3b";
const TARGET = "tests/fixtures/chat-actions-model-candidate.mjs";
export const EXPECTED_BROKEN = "export function add(a, b) { return a - b; }\n";
const FENCE = /^\x60{3}(?:javascript|js|mjs)?\s*([\s\S]*?)\s*\x60{3}$/i;
function verifiedSource(content) {
  if (typeof content !== "string" || content.length > 220 || /[\u0000-\u0008]/.test(content)) return null;
  let s = content.trim();
  const m = s.match(FENCE);
  if (m) s = m[1].trim();
  // Only one approved arithmetic fix to one test fixture. No model commands or arbitrary source execution.
  if (!/^export\s+function\s+add\s*\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s+a\s*\+\s*b\s*;\s*\}$/.test(s)) return null;
  return "export function add(a, b) { return a + b; }\n";
}
export function verifyCandidate({ current, generated, headSha, issue = 1865, pr = 1866 }) {
  if (current !== EXPECTED_BROKEN) throw Error("FIXTURE_BASELINE_CHANGED");
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw Error("UNPINNED_PR_HEAD");
  if (issue !== 1865 || pr !== 1866) throw Error("OUTSIDE_EXPLICIT_PILOT_SCOPE");
  const accepted = verifiedSource(generated);
  if (!accepted) return { accepted:false, reason:"MODEL_OUTPUT_OUT_OF_SCOPE" };
  return { accepted:true, path:TARGET, content:accepted,
    beforeHash:createHash("sha256").update(current).digest("hex"),
    afterHash:createHash("sha256").update(accepted).digest("hex"),
    headSha, issue, pr, producer:"OLLAMA_REAL_MODEL", model:MODEL,
    authority:"CANDIDATE_ONLY_NO_REMOTE_WRITE" };
}

export async function modelProposal(fetchImpl, current, headSha) {
  const prompt = [
    "You are a coding model fixing exactly one isolated JavaScript test fixture.",
    "Return exactly one source line, no explanations, no markdown, no other code.",
    "The fixture must export function add(a, b) and return their arithmetic sum.",
    "Existing fixture code:", current.trim(),
    "Return the COMPLETE corrected source file. Do not change any other file.",
  ].join("\n");
  const output = await fetchImpl(HOST + "/api/chat", {
    method:"POST",headers:{"Content-Type":"application/json"},
    signal:AbortSignal.timeout(180_000),
    body:JSON.stringify({model:MODEL,stream:false,options:{temperature:0,num_predict:100},
      messages:[{role:"user",content:prompt}]}),
  });
  if (!output.ok) throw Error("MODEL_INFERENCE_FAILED_HTTP_"+output.status);
  const response = await output.json();
  const text = response?.message?.content;
  if (typeof text !== "string" || text.length > 4000) throw Error("MODEL_OUTPUT_INVALID");
  return verifyCandidate({current,generated:text,headSha});
}

if (process.argv[1]?.endsWith("/chat-actions-real-model.mjs")) {
  const headSha=process.env.GITHUB_SHA;
  if (process.env.GITHUB_EVENT_NAME!=="pull_request" || !headSha ||
      process.env.GITHUB_REPOSITORY!=="haji84/AI-" || process.env.GITHUB_EVENT_PATH===undefined)
    throw Error("UNTRUSTED_HOSTED_SCOPE");
  // GITHUB_SHA on pull_request is a merge SHA. Bind the candidate to the exact PR head.
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,"utf8"));
  if (event.number!==1866 || event.pull_request?.number!==1866 ||
      event.pull_request?.base?.ref!=="main" ||
      event.pull_request?.head?.repo?.full_name!=="haji84/AI-" ||
      event.pull_request?.base?.repo?.full_name!=="haji84/AI-" ||
      event.pull_request?.head?.ref!=="codex/1865-pr-reuse-advisory")
    throw Error("PILOT_PR_NOT_VERIFIED");
  const exactHead=event.pull_request.head.sha;
  const current=readFileSync(TARGET,"utf8");
  const result=await modelProposal(fetch,current,exactHead);
  if(!result.accepted)throw Error("MODEL_GENERATED_PATCH_FAILED_VALIDATION");
  const temp=process.env.RUNNER_TEMP;
  if(!temp)throw Error("RUNNER_TEMP_MISSING");
  const dir=temp+"/chat-actions-ai-proposal";
  mkdirSync(dir,{recursive:true});
  writeFileSync(dir+"/source.mjs",result.content,"utf8");
  writeFileSync(dir+"/receipt.json",JSON.stringify({...result,content:undefined},null,2)+"\n","utf8");
  // Model-generated JavaScript is never executed on the runner.
  process.stdout.write("MODEL_GENERATION_VERIFIED "+JSON.stringify({...result,content:undefined})+"\n");
}
