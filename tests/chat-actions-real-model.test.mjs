import test from "node:test";
import assert from "node:assert/strict";
import { verifyCandidate, modelProposal, EXPECTED_BROKEN } from "../scripts/chat-actions-real-model.mjs";
const SHA="a".repeat(40);
test("valid model code is a bounded candidate only and never a merge authorization",()=>{
 const result=verifyCandidate({current:EXPECTED_BROKEN,generated:"export function add(a, b) { return a + b; }",headSha:SHA});
 assert.equal(result.accepted,true);
 assert.equal(result.path,"tests/fixtures/chat-actions-model-candidate.mjs");
 assert.equal(result.producer,"OLLAMA_REAL_MODEL");
 assert.equal(result.authority,"CANDIDATE_ONLY_NO_REMOTE_WRITE");
 assert.equal(result.content,"export function add(a, b) { return a + b; }\n");
});
test("model output is not trusted to emit arbitrary commands or files",()=>{
 for(const generated of ["process.exit(0);","export function add(a,b){return a-b;}",
  "export function add(a,b){return a+b;} console.log(process.env)",
  "export function add(a,b){return a+b;} // ignored"]){
  assert.equal(verifyCandidate({current:EXPECTED_BROKEN,generated,headSha:SHA}).accepted,false);
 }
});
test("stale fixture and incorrect SHA never generate an accepted candidate",()=>{
 assert.throws(()=>verifyCandidate({current:"different",generated:"x",headSha:SHA}),/FIXTURE_BASELINE_CHANGED/);
 assert.throws(()=>verifyCandidate({current:EXPECTED_BROKEN,generated:"x",headSha:"wrong"}),/UNPINNED_PR_HEAD/);
});
test("model source can be fenced but extra code is rejected",()=>{
 const a=verifyCandidate({current:EXPECTED_BROKEN,generated:"\x60\x60\x60javascript\nexport function add(a,b){return a+b;}\n\x60\x60\x60",headSha:SHA});
 assert.equal(a.accepted,true);
});
test("real API client contract uses loopback Ollama, unprivileged and bounded outputs",async()=>{
 let request=null;
 const fake=async(url,params)=>{
  request={url,params};
  return {ok:true,json:async()=>({message:{content:"export function add(a,b){return a+b;}"}})};
 };
 const r=await modelProposal(fake,EXPECTED_BROKEN,SHA);
 assert.equal(r.accepted,true);
 assert.equal(request.url,"http://127.0.0.1:11434/api/chat");
 const parsed=JSON.parse(request.params.body);
 assert.equal(parsed.model,"qwen2.5-coder:3b");
 assert.equal(parsed.stream,false);
 assert.equal(parsed.options.temperature,0);
});
test("broken inference must fail and does not invent successful repair",async()=>{
 await assert.rejects(()=>modelProposal(async()=>({ok:false,status:503}),EXPECTED_BROKEN,SHA),/MODEL_INFERENCE_FAILED_HTTP_503/);
});
