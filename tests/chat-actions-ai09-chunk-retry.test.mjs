import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { validatePilotReviewEvent, prepareBoundedReview, reviewWithLocalModel,
  PILOT_BASE_SHA, AI09_RESPONSE_SCHEMA, classifyAi09ResponseShape,
  buildAi09OllamaRequest } from "../scripts/chat-actions-ai09-chunk-retry.mjs";
import { reviewLocalPatch } from "../src/orchestrator/ai09-local-reviewer.mjs";
import { compareToReviewChunks, consolidateChunkReviews,
  makeBlockedReview } from "../src/orchestrator/ai09-pr-review-automation.mjs";
import { assertCompleteComparison } from "../scripts/goriq-ai09-compare-coverage.mjs";
import { holdUngroundedAdvisory } from "../scripts/goriq-ai09-finding-anchors.mjs";
const HEAD="a".repeat(40);
const modules={
 reviewer:{reviewLocalPatch},
 batches:{compareToReviewChunks,consolidateChunkReviews,makeBlockedReview},
 coverage:{assertCompleteComparison},
 anchor:{holdUngroundedAdvisory},
};
const scope={number:1866,pull_request:{number:1866,state:"open",
 head:{sha:HEAD,ref:"codex/1865-pr-reuse-advisory",repo:{full_name:"haji84/AI-"}},
 base:{sha:"b".repeat(40),ref:"main",repo:{full_name:"haji84/AI-"}}}};
const compare={base_commit:{sha:PILOT_BASE_SHA},commits:[{sha:HEAD}],
 status:"ahead",ahead_by:1,total_commits:1,files:[
  {filename:"src/example.ts",additions:1,deletions:1,patch:"@@ -1 +1 @@\n-old\n+new"},
 ]};
test("isolated reviewer enforces real same-repository pinned PR and head",()=>{
 assert.deepEqual(validatePilotReviewEvent(scope,"haji84/AI-"),{
  headSha:HEAD,mainSha:"b".repeat(40),
 });
 assert.throws(()=>validatePilotReviewEvent({...scope,number:1867},"haji84/AI-"),/UNTRUSTED_PR_REVIEW_EVENT/);
 assert.throws(()=>validatePilotReviewEvent(scope,"attacker/repo"),/UNTRUSTED_PR_REVIEW_EVENT/);
});
test("trusted chunker keeps complete patch coverage and bounds model input",async()=>{
 const p=await prepareBoundedReview(compare,HEAD,modules);
 assert.equal(p.paths.length,1);
 assert.ok(p.chunks.length>=1);
 assert.ok(p.chunks.every(c=>Buffer.byteLength(c.patch,"utf8")<=4096));
 assert.ok(p.chunks.every(c=>c.paths[0]==="src/example.ts"));
});
test("missing hunk bytes fail closed before consulting AI",async()=>{
 const bad={...compare,files:[{...compare.files[0],additions:2}]};
 await assert.rejects(()=>prepareBoundedReview(bad,HEAD,modules),/incomplete_github_patch/);
});
test("mismatched compare revision is not a valid AI09 review",async()=>{
 await assert.rejects(()=>prepareBoundedReview({...compare,commits:[{sha:"c".repeat(40)}]},HEAD,modules),
 /REVIEW_COMPARISON_MISMATCH/);
});
test("every chunk must produce a valid AI09 result to report no findings",async()=>{
 const p=await prepareBoundedReview(compare,HEAD,modules);
 const r=await reviewWithLocalModel({prepared:p,headSha:HEAD,modules,
  infer:async()=>JSON.stringify({verdict:"NO_FINDINGS",findings:[]})});
 assert.equal(r.status,"NO_ACTIONABLE_FINDINGS");
 assert.equal(r.githubApprovalSatisfied,false);
 assert.equal(r.mergeAuthorized,false);
 assert.equal(r.evidenceClass,"AI_ASSERTED");
});
test("model JSON errors preserve BLOCKED rather than claiming reviewed",async()=>{
 const p=await prepareBoundedReview(compare,HEAD,modules);
 const r=await reviewWithLocalModel({prepared:p,headSha:HEAD,modules,
  infer:async()=>"{not-json"});
 assert.equal(r.status,"BLOCKED");
 assert.ok(r.blockers.length>0);
});
test("indeterminate model verdict never becomes PASS",async()=>{
 const p=await prepareBoundedReview(compare,HEAD,modules);
 const r=await reviewWithLocalModel({prepared:p,headSha:HEAD,modules,
  infer:async()=>JSON.stringify({verdict:"INCONCLUSIVE",findings:[]})});
 assert.equal(r.status,"INCONCLUSIVE");
});

test("local Qwen model API request enforces native JSON schema without changing model-review authority",()=>{
 const data=buildAi09OllamaRequest("Review this exact source diff");
 assert.equal(data.model,"qwen2.5-coder:3b");
 assert.equal(data.stream,false);
 assert.equal(data.format,AI09_RESPONSE_SCHEMA);
 assert.deepEqual(data.format.required,["verdict","findings"]);
 assert.deepEqual(data.format.properties.verdict.enum,
  ["NO_FINDINGS","CHANGES_REQUESTED","INCONCLUSIVE"]);
 assert.deepEqual(data.format.properties.findings.items.required,
  ["path","line","severity","summary","evidence","proposedFix"]);
 assert.equal(data.options.temperature,0);
 assert.equal(data.messages[0].content,"Review this exact source diff");
 assert.equal(Object.hasOwn(data,"GITHUB_TOKEN"),false);
 assert.throws(()=>buildAi09OllamaRequest(""),/INVALID_AI09_MODEL_PROMPT/);
});
test("safe Ollama format classification separates malformed JSON, wrong schema, and valid findings",()=>{
 assert.equal(classifyAi09ResponseShape(undefined),"MISSING_TEXT");
 assert.equal(classifyAi09ResponseShape("{oops"),"INVALID_JSON");
 assert.equal(classifyAi09ResponseShape("[]"),"NOT_OBJECT");
 assert.equal(classifyAi09ResponseShape('{"verdict":"APPROVED","findings":[]}'),"INVALID_VERDICT");
 assert.equal(classifyAi09ResponseShape('{"verdict":"NO_FINDINGS","findings":"foo"}'),"INVALID_FINDINGS_ARRAY");
 assert.equal(classifyAi09ResponseShape('{"verdict":"NO_FINDINGS","findings":[{}]}'),"VERDICT_FINDING_CONFLICT");
 assert.equal(classifyAi09ResponseShape('{"verdict":"CHANGES_REQUESTED","findings":[]}'),"VERDICT_FINDING_CONFLICT");
 assert.equal(classifyAi09ResponseShape('{"verdict":"INCONCLUSIVE","findings":[]}'),
  "SHAPE_VALID_PENDING_TRUSTED_REVIEW");
 assert.equal(classifyAi09ResponseShape('{"verdict":"NO_FINDINGS","findings":[]}'),
  "SHAPE_VALID_PENDING_TRUSTED_REVIEW");
});
test("model cannot pass line, path or severity validation by substituting guessed review data",()=>{
 const finding={path:"src/actual.ts",line:17,severity:"high",
  summary:"Concrete negative impact",evidence:"Quoted added source line",proposedFix:"Add regression for affected request"};
 const encode=ob=>JSON.stringify({verdict:"CHANGES_REQUESTED",findings:[ob]});
 assert.equal(classifyAi09ResponseShape(encode(finding)),"SHAPE_VALID_PENDING_TRUSTED_REVIEW");
 assert.equal(classifyAi09ResponseShape(encode({...finding,line:null})),"INVALID_FINDING_POSITION");
 assert.equal(classifyAi09ResponseShape(encode({...finding,line:0})),"INVALID_FINDING_POSITION");
 assert.equal(classifyAi09ResponseShape(encode({...finding,path:""})),"INVALID_FINDING_POSITION");
 assert.equal(classifyAi09ResponseShape(encode({...finding,severity:"approved"})),"INVALID_FINDING_SEVERITY");
 assert.equal(classifyAi09ResponseShape(encode({...finding,evidence:""})),"INVALID_FINDING_FIELDS");
});
test("safe diagnostics detect repeated short invalid Ollama response, never reinterpret it as PASS",()=>{
 const raw=JSON.stringify({type:"review",status:"done",text:"unsupported review wrapper"});
 const response=raw.padEnd(209," ");
 assert.equal(response.length,209);
 assert.equal(classifyAi09ResponseShape(response),"INVALID_VERDICT");
 // Even correct JSON shape is only input to the independent trusted reviewer.
 assert.equal(classifyAi09ResponseShape('{"verdict":"NO_FINDINGS","findings":[]}'),
  "SHAPE_VALID_PENDING_TRUSTED_REVIEW");
});
