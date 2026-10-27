import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import * as qualification from '../scripts/goriq-ai09-public-qualification.mjs';
import {compareToReviewChunks} from '../src/orchestrator/ai09-pr-review-automation.mjs';
import {PROFILE,buildCases,validateAuthorization,validateRunHistory,readBounded,runQualification,modelIdentity} from '../scripts/goriq-ai09-public-qualification.mjs';

const sha = b=>createHash('sha256').update(b).digest('hex');
const sourceHead='e'.repeat(40);
const env={GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:'haji84/AI-',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'100',GITHUB_HEAD_REF:'codex/1867-ai09-hunk-prefix-fix',RUNNER_OS:'Linux',RUNNER_ARCH:'X64',GITHUB_ACTOR:'haji84'};
const event={action:'synchronize',number:1868,sender:{login:'haji84'},repository:{full_name:'haji84/AI-',private:false},pull_request:{number:1868,head:{sha:sourceHead,repo:{full_name:'haji84/AI-'}},base:{ref:'main',repo:{full_name:'haji84/AI-'}}}};
function auth(){return {schemaVersion:1,experimentNumber:2,maxModelCalls:8,priorRunId:40457734076,status:'APPROVED_BY_OWNER_CHAT',repository:'haji84/AI-',prNumber:1868,parentSha:PROFILE.parentSha,
  patchSha256:'b'.repeat(64),files:Object.fromEntries(PROFILE.files.map(p=>[p,'a'.repeat(64)])),
  storageZeroChargeEvidence:{method:'OWNER_VERIFIED_EXISTING_HARD_STOP',verifiedBy:'haji84',verifiedAt:'2026-10-27T00:00:00Z',url:'https://github.com/settings/billing',maximumCharge:0,covers:['artifacts','logs']}};}
function profile(){return {head:sourceHead,parent:PROFILE.parentSha,dirty:false,patchSha256:'b'.repeat(64),
  files:PROFILE.files.map(path=>({path,status:'M',mode:'100644',sha256:'a'.repeat(64)}))};}
function history(){const common={workflow_id:33,path:'.github/workflows/goriq-ai09-public-qualification.yml',repository:{full_name:'haji84/AI-'},event:'pull_request',run_attempt:1};return [{total_count:2,workflow_runs:[
 {...common,id:40457734076,run_number:1,head_sha:'aeaa95e500e8318d0b7aa5a452af45c2b92a324b',status:'completed',conclusion:'failure'},
 {...common,id:100,run_number:2,head_sha:sourceHead,status:'in_progress',conclusion:null}]}];}
const comment=a=>({user:{login:'haji84',type:'User'},body:'<!-- AI09_PUBLIC_QUALIFICATION_SCOPE -->\n```json\n'+JSON.stringify(a)+'\n```'});
test('only exact owner-approved profile with verified existing zero-charge stop is accepted',()=>assert.doesNotThrow(()=>validateAuthorization(comment(auth()),event,env,profile())));
for(const [label,mutate] of [
  ['pending',a=>{a.status='PENDING';}],['old experiment',a=>{a.experimentNumber=1;}],['excess calls',a=>{a.maxModelCalls=9;}],['wrong prior',a=>{a.priorRunId=99;}],['wrong blob',a=>{a.files[PROFILE.files[0]]='c'.repeat(64);}],
  ['missing storage proof',a=>{a.storageZeroChargeEvidence=null;}],['billable storage',a=>{a.storageZeroChargeEvidence.maximumCharge=1;}],
  ['wrong patch',a=>{a.patchSha256='d'.repeat(64);}],['extra file',a=>{a.files['src/extra.js']='a'.repeat(64);}]
])test('reject authorization: '+label,()=>{const a=auth();mutate(a);assert.throws(()=>validateAuthorization(comment(a),event,env,profile()),/AUTHORIZATION/);});
test('reject reattempt, private repo, wrong PR, sender, parent, added rather than modified file and symlink',()=>{
  for(const bad of [{...env,GITHUB_RUN_ATTEMPT:'2'},{...env,GITHUB_REPOSITORY:'elsewhere/repo'}])assert.throws(()=>validateAuthorization(comment(auth()),event,bad,profile()),/SOURCE/);
  for(const bad of [{...event,number:2},{...event,sender:{login:'attacker'}},{...event,repository:{...event.repository,private:true}}])assert.throws(()=>validateAuthorization(comment(auth()),bad,env,profile()),/SOURCE/);
  for(const bad of [{...profile(),parent:'c'.repeat(40)},{...profile(),files:profile().files.map(f=>({...f,status:'A'}))},{...profile(),files:profile().files.map(f=>({...f,mode:'120000'}))}])assert.throws(()=>validateAuthorization(comment(auth()),event,env,bad),/SOURCE/);
});
test('dirty executable working tree is rejected even when committed blobs match',()=>{
  assert.throws(()=>validateAuthorization(comment(auth()),event,env,{...profile(),dirty:true}),/SOURCE/);
});
test('only complete second-run history with the exact failed prior experiment is accepted',()=>{
  assert.doesNotThrow(()=>validateRunHistory(history(),100,sourceHead));
  for(const change of [p=>{p[0].total_count=3;},p=>{p[0].workflow_runs[0].id=99;},
    p=>{p[0].workflow_runs[0].head_sha='a'.repeat(40);},p=>{p[0].workflow_runs[0].conclusion='success';},
    p=>{p[0].workflow_runs[0].status='in_progress';},p=>{p[0].workflow_runs[1].run_attempt=2;},
    p=>{p[0].workflow_runs[1].run_number=3;},p=>{p[0].workflow_runs[1].status='completed';},
    p=>{p[0].workflow_runs[1].workflow_id=44;},p=>{p[0].workflow_runs[1].repository.full_name='foreign/repo';}]){
    const p=history();change(p);assert.throws(()=>validateRunHistory(p,100,sourceHead),/HISTORY/);
  }
  assert.throws(()=>validateRunHistory([],100,sourceHead),/HISTORY/);
});
test('deleted old history, extra future runs and duplicate receipts never reset second-run budget',()=>{
  const missing=history();missing[0].total_count=1;missing[0].workflow_runs.shift();
  assert.throws(()=>validateRunHistory(missing,100,sourceHead),/HISTORY/);
  const future=history();future[0].total_count=3;future[0].workflow_runs.push({...future[0].workflow_runs[1],id:101,run_number:3});
  assert.throws(()=>validateRunHistory(future,100,sourceHead),/HISTORY/);
  assert.throws(()=>validateRunHistory(history().concat(history()),100,sourceHead),/HISTORY/);
});
test('missing workflow identity on both records is not verified equality',()=>{
  const p=history();for(const run of p[0].workflow_runs)delete run.workflow_id;
  assert.throws(()=>validateRunHistory(p,100,sourceHead),/HISTORY/);
});
test('strict response schema forbids the actual captured pipe-separated verdict',()=>{
  const format=qualification.reviewResponseFormat(['src/arithmetic.js']);
  assert.deepEqual(format.properties.verdict.enum,['NO_FINDINGS','CHANGES_REQUESTED','INCONCLUSIVE']);
  assert.equal(format.properties.verdict.enum.includes('NO_FINDINGS|CHANGES_REQUESTED|INCONCLUSIVE'),false);
  assert.equal(format.additionalProperties,false);assert.equal(format.properties.findings.maxItems,20);
  assert.deepEqual(format.properties.findings.items.properties.path.enum,['src/arithmetic.js']);
  assert.equal(format.properties.findings.items.properties.line.maximum,500000);
});
test('bounded streaming preserves growing current prefix, complete bytes and hashes',async()=>{
  const snapshots=[];const chunks=[Buffer.from('ab'),Buffer.from('cde')];
  const body={async *[Symbol.asyncIterator](){yield* chunks;}};
  const r=await readBounded({body},4,s=>snapshots.push({...s}));
  assert.equal(r.complete,false);assert.equal(r.byteLength,4);assert.equal(Buffer.from(r.base64,'base64').toString(),'abcd');assert.equal(r.sha256,sha('abcd'));
  assert.equal(snapshots[0].complete,false);assert.equal(snapshots[0].byteLength,2);
  const ok=await readBounded({body:{async *[Symbol.asyncIterator](){yield Buffer.from('abcd');}}},4,()=>{});
  assert.equal(ok.complete,true);assert.equal(ok.sha256,sha('abcd'));
});
test('read failure retains incomplete prefix without claiming complete output',async()=>{
  const r=await readBounded({body:{async *[Symbol.asyncIterator](){yield Buffer.from('prefix');throw Error('upstream secret text');}}},64,()=>{});
  assert.equal(r.complete,false);assert.equal(r.error,'BODY_READ_FAILED');assert.equal(Buffer.from(r.base64,'base64').toString(),'prefix');
});
test('model identity requires exactly pinned full manifest and running context',()=>{
  assert.equal(modelIdentity({models:[{name:'qwen3:1.7b',digest:PROFILE.modelDigest}]}),PROFILE.modelDigest);
  assert.throws(()=>modelIdentity({models:[{name:'qwen3:1.7b',digest:'b'.repeat(64)}]}),/MODEL_IDENTITY/);
  assert.throws(()=>modelIdentity({models:[]}),/MODEL_IDENTITY/);
  assert.throws(()=>modelIdentity({models:[{name:'qwen3:1.7b',digest:PROFILE.modelDigest,context_length:4096}]},true),/MODEL_IDENTITY/);
});
// Frozen public GitHub comparison: attached below by proposal preparation.
const comparison = {
  "status": "ahead",
  "ahead_by": 2,
  "total_commits": 2,
  "files": [
    {
      "filename": "docs/jarvis-reverse-traceability.json",
      "patch": (
        "@@ -4748,7 +4748,7 @@\n     },\n     {\n       \"path\": \"src/orchestrator/ai09-pr-review-automation." +
        "mjs\",\n-      \"sha256\": \"a77ce0a4c3aa3cd00793c5e5f0074f3f78a56d882baf08d4b39dfdf5643a92e8\",\n+    " +
        "  \"sha256\": \"437e12d94ad1b091c8de7e637ed052886be04325bf0c0ed2ba8ee3e6e5e0959f\",\n       \"classifi" +
        "cation\": \"COVERED_BY_REQUIREMENT\",\n       \"requirement_ids\": [\n         \"CORE-010\","
      ),
      "additions": 1,
      "deletions": 1,
      "changes": 2
    },
    {
      "filename": "scripts/goriq-ai09-finding-anchors.mjs",
      "patch": (
        "@@ -25,7 +25,7 @@ export function anchorAudit(findings, patch) {\n       continue;\n     }\n     if" +
        " (current===null||path===null)continue;\n-    if(row.startsWith(\"+\")&&!row.startsWith(\"+++\")){\n+ " +
        "   if(row.startsWith(\"+\")){\n       additions.get(path).set(current,row.slice(1));current++;\n    " +
        " } else if(row.startsWith(\" \"))current++;\n     else if(row.startsWith(\"-\")||row.startsWith(\"\\\\\")" +
        "||row.startsWith(\"#\")){ /* source old line or metadata */ }"
      ),
      "additions": 1,
      "deletions": 1,
      "changes": 2
    },
    {
      "filename": "src/orchestrator/ai09-pr-review-automation.mjs",
      "patch": (
        "@@ -153,13 +153,19 @@ export function hasAddedCredentialLogging(patch) {\n \n export function cons" +
        "olidateChunkReviews(reports, scope, chunks) {\n   if (!Array.isArray(reports) || !Array.isArray(c" +
        "hunks) ||\n-    !chunks.length || chunks.length > MAX_CHUNKS || reports.length !== chunks.length)" +
        " {\n+    !chunks.length || chunks.length > MAX_CHUNKS || reports.length > chunks.length) {\n     r" +
        "eturn makeBlockedReview(scope, \"incomplete_model_review\");\n   }\n   let sawInconclusive = false;\n" +
        "   let sawChanges = false;\n   const findings = [];\n-  for (let i = 0; i < chunks.length; i++) {\n" +
        "+  // Preserve bounded already-reviewed evidence even when later coverage fails.\n+  // Missing, " +
        "invalid or over-budget coverage always remains BLOCKED.\n+  const blocked = reason => ({\n+    ..." +
        "makeBlockedReview(scope, reports.length !== chunks.length ? \"incomplete_model_review\" : reason)," +
        "\n+    findings: findings.slice(0, 20),\n+  });\n+  for (let i = 0; i < reports.length; i++) {\n    " +
        " const report = reports[i];\n     const chunk = chunks[i];\n     if (!report || report.reviewer !=" +
        "= \"AI-09\" || report.evidenceClass !== \"AI_ASSERTED\" ||\n@@ -171,13 +177,15 @@ export function con" +
        "solidateChunkReviews(reports, scope, chunks) {\n       JSON.stringify(report.scope.paths) !== JSO" +
        "N.stringify(chunk.paths) ||\n       !Array.isArray(report.findings) ||\n       report.findings.som" +
        "e(finding => !chunk.paths.includes(finding.path))) {\n-      return makeBlockedReview(scope, \"rev" +
        "iew_chunk_invalid_or_blocked\");\n+      return blocked(\"review_chunk_invalid_or_blocked\");\n     }" +
        "\n     if (report.status === \"INCONCLUSIVE\") sawInconclusive = true;\n     if (report.status === \"" +
        "CHANGES_REQUESTED\") sawChanges = true;\n-    findings.push(...report.findings);\n-    if (findings" +
        ".length > 20) return makeBlockedReview(scope, \"too_many_review_findings\");\n+    const capacity =" +
        " 20 - findings.length;\n+    findings.push(...report.findings.slice(0, capacity));\n+    if (repor" +
        "t.findings.length > capacity) return blocked(\"too_many_review_findings\");\n   }\n+  if (reports.le" +
        "ngth !== chunks.length) return blocked(\"incomplete_model_review\");\n   const status = sawInconclu" +
        "sive ? \"INCONCLUSIVE\" :\n     sawChanges ? \"CHANGES_REQUESTED\" : \"NO_ACTIONABLE_FINDINGS\";\n   // " +
        "The backstop does not invent AI findings or authorize a fix."
      ),
      "additions": 13,
      "deletions": 5,
      "changes": 18
    },
    {
      "filename": "tests/ai09-finding-anchors.test.mjs",
      "patch": (
        "@@ -49,3 +49,27 @@ test(\"multi-hunk new-line accounting excludes deleted lines\",()=>{\n  assert.e" +
        "qual(anchorAudit([f],p).complete,true);\n  assert.equal(anchorAudit([{...f,line:9}],p).complete,f" +
        "alse);\n });\n+\n+test(\"increment additions and following new-side coordinates retain exact quote a" +
        "nchoring\",()=>{\n+ const p=\"diff --git a/src/counter.js b/src/counter.js\\n\"+\n+  \"@@ -1,2 +1,4 @@\\" +
        "n let pendingCounter = 0;\\n+++pendingCounter;\\n+const afterIncrement = true;\\n return pendingCou" +
        "nter;\";\n+ const f={path:\"src/counter.js\",line:2,evidence:\"Added \"+String.fromCharCode(96)+\"++pen" +
        "dingCounter;\"+String.fromCharCode(96)};\n+ assert.equal(anchorAudit([f],p).complete,true);\n+ asse" +
        "rt.equal(anchorAudit([{...f,line:3,evidence:\"Added \"+String.fromCharCode(96)+\"const afterIncreme" +
        "nt = true;\"+String.fromCharCode(96)}],p).complete,true);\n+ const r=holdUngroundedAdvisory({...as" +
        "serted,findings:[f]},p);\n+ assert.equal(r.status,\"CHANGES_REQUESTED\");\n+ assert.equal(r.mergeAut" +
        "horized,false);\n+ assert.equal(r.githubApprovalSatisfied,false);\n+});\n+test(\"increment handling " +
        "does not anchor context, headers, other paths or fabricated lines\",()=>{\n+ const p=\"diff --git a" +
        "/src/counter.js b/src/counter.js\\n--- a/src/counter.js\\n+++ b/src/counter.js\\n\"+\n+  \"@@ -1 +1,2 " +
        "@@\\n const beforeCounter = 0;\\n+++pendingCounter;\";\n+ const f={path:\"src/counter.js\",line:2,evid" +
        "ence:\"Added \"+String.fromCharCode(96)+\"++pendingCounter;\"+String.fromCharCode(96)};\n+ for(const " +
        "wrong of [{...f,line:1},{...f,line:3},{...f,path:\"other.js\"},\n+   {...f,evidence:\"Added \"+String" +
        ".fromCharCode(96)+\"b/src/counter.js\"+String.fromCharCode(96)}]){\n+  assert.equal(anchorAudit([wr" +
        "ong],p).complete,false);\n+  const r=holdUngroundedAdvisory({...asserted,findings:[wrong]},p);\n+ " +
        " assert.equal(r.status,\"INCONCLUSIVE\");\n+  assert.equal(r.mergeAuthorized,false);\n+ }\n+});"
      ),
      "additions": 24,
      "deletions": 0,
      "changes": 24
    },
    {
      "filename": "tests/ai09-pr-review-automation.test.mjs",
      "patch": (
        "@@ -440,3 +440,65 @@ test(\"GitHub API patch must match full per-file addition and deletion total" +
        "s\", (\n     files: [{ ...complete.files[0], patch: null }],\n   }), /unverifiable_patch_statistics" +
        "/);\n });\n+\n+function prefixFixture() {\n+  const full=compareToReviewChunks({status:\"ahead\",ahead" +
        "_by:1,total_commits:1,\n+    files:[\"src/file.ts\",\"src/other.ts\"].map(filename=>({filename,\n+    " +
        "  patch:\"@@ -0,0 +1,1 @@\\n+export const value = 1;\"}))},shaA,shaB);\n+  const scope={baseSha:shaA" +
        ",headSha:shaB,paths:full.paths,patchSha256:full.patchSha256};\n+  const reports=full.chunks.map(c" +
        "hunk=>({...goodResult(),scope:{...scope,\n+    paths:chunk.paths,patchSha256:createHash(\"sha256\")" +
        ".update(chunk.patch).digest(\"hex\")}}));\n+  const finding={path:full.paths[0],line:1,severity:\"me" +
        "dium\",\n+    summary:\"Impact: bounded example still needs independent verification.\",\n+    eviden" +
        "ce:\"`export const value = 1;`\",proposedFix:\"Verify this claim with independent behavior evidence" +
        ".\"};\n+  reports[0]={...reports[0],status:\"CHANGES_REQUESTED\",findings:[finding],\n+    blockers:[" +
        "\"model_findings_require_action\"]};\n+  return {full,scope,reports,finding};\n+}\n+\n+test(\"proposal:" +
        " missing later chunks retain earlier claims while staying BLOCKED\",()=>{\n+  const f=prefixFixtur" +
        "e();\n+  const result=consolidateChunkReviews(f.reports.slice(0,1),f.scope,f.full.chunks);\n+  ass" +
        "ert.equal(result.status,\"BLOCKED\");\n+  assert.deepEqual(result.blockers,[\"incomplete_model_revie" +
        "w\"]);\n+  assert.deepEqual(result.findings,[f.finding]);\n+  assert.equal(validateReviewReceipt(re" +
        "ceipt(result),expected),true);\n+  assert.equal(result.githubApprovalSatisfied,false);assert.equa" +
        "l(result.mergeAuthorized,false);\n+  assert.match(formatReviewComment(receipt(result)),/Review bl" +
        "ockers.*incomplete\\\\_model\\\\_review/);\n+});\n+\n+test(\"proposal: blocked later chunk cannot erase " +
        "a valid preceding finding\",()=>{\n+  const f=prefixFixture();\n+  f.reports[1]={...f.reports[1],st" +
        "atus:\"BLOCKED\",blockers:[\"local_model_unavailable_or_invalid_response\"]};\n+  const result=consol" +
        "idateChunkReviews(f.reports,f.scope,f.full.chunks);\n+  assert.equal(result.status,\"BLOCKED\");\n+ " +
        " assert.deepEqual(result.findings,[f.finding]);\n+  assert.deepEqual(result.blockers,[\"review_chu" +
        "nk_invalid_or_blocked\"]);\n+});\n+\n+test(\"proposal: forged later chunk remains blocked and adds no" +
        " untrusted finding\",()=>{\n+  const f=prefixFixture();\n+  f.reports[1].scope.patchSha256=\"0\".repe" +
        "at(64);\n+  const result=consolidateChunkReviews(f.reports,f.scope,f.full.chunks);\n+  assert.equa" +
        "l(result.status,\"BLOCKED\");assert.deepEqual(result.findings,[f.finding]);\n+  assert.equal(result" +
        ".mergeAuthorized,false);\n+});\n+\n+test(\"proposal: overflow retains bounded prefix and never a cle" +
        "an review\",()=>{\n+  const f=prefixFixture();\n+  f.reports[0].findings=Array.from({length:20},()=" +
        ">({...f.finding}));\n+  f.reports[1]={...f.reports[1],status:\"CHANGES_REQUESTED\",\n+    findings:[" +
        "{...f.finding,path:f.full.paths[1]}],blockers:[\"model_findings_require_action\"]};\n+  const resul" +
        "t=consolidateChunkReviews(f.reports,f.scope,f.full.chunks);\n+  assert.equal(result.status,\"BLOCK" +
        "ED\");assert.equal(result.findings.length,20);\n+  assert.deepEqual(result.blockers,[\"too_many_rev" +
        "iew_findings\"]);\n+  assert.equal(result.githubApprovalSatisfied,false);\n+});\n+\n+test(\"proposal: " +
        "retained synthetic secret-shaped text still fails publisher validation\",()=>{\n+  const f=prefixF" +
        "ixture();\n+  f.reports[0].findings[0].evidence=\"api_key=EXAMPLE_NOT_A_REAL_CREDENTIAL_123\";\n+  c" +
        "onst result=consolidateChunkReviews(f.reports.slice(0,1),f.scope,f.full.chunks);\n+  assert.equal" +
        "(result.status,\"BLOCKED\");assert.equal(result.findings.length,1);\n+  assert.equal(validateReview" +
        "Receipt(receipt(result),expected),false);\n+});"
      ),
      "additions": 62,
      "deletions": 0,
      "changes": 62
    }
  ]
};
test('actual frozen public comparison gives5 exact source chunks plus3 controls',()=>{
  const cases=buildCases(comparison);assert.equal(cases.length,8);assert.equal(cases.filter(c=>c.kind==='source').length,5);
  for(const c of cases){assert.ok(c.patch);assert.ok(c.paths.length===1);assert.ok(Buffer.byteLength(c.patch)<=4096);}
  const forged=JSON.parse(JSON.stringify(comparison));forged.files[0].patch+='\n+forged';assert.throws(()=>buildCases(forged),/SOURCE_PLAN/);
});
function mockApi({badAt=0,cutoff=false,drift=false,overflowAt=0,httpFailureAt=0,echoAt=0,missControl=false}={}){
  let chats=0;const requests=[];
  const call=async(url,options={})=>{
    assert.ok(url.startsWith('http://127.0.0.1:11434/api/'));assert.equal(options.redirect,'error');
    const suffix=url.split('/').at(-1);
    if(suffix==='version')return response({version:'0.34.0'});
    if(suffix==='tags'||suffix==='ps')return response({models:[{name:'qwen3:1.7b',digest:drift&&chats>0?'b'.repeat(64):PROFILE.modelDigest,context_length:8192}]});
    assert.equal(suffix,'chat');chats++;const request=JSON.parse(options.body);requests.push(request);
    assert.equal(request.model,'qwen3:1.7b');assert.equal(request.think,false);assert.equal(request.options.num_predict,1536);assert.equal(request.stream,false);
    assert.deepEqual(request.format,qualification.reviewResponseFormat(JSON.parse(request.messages[0].content.match(/Changed paths: (.+)/)[1])));
    assert.equal(request.tools,undefined);assert.equal(options.headers.Authorization,undefined);
    if(overflowAt===chats)return {ok:true,status:200,body:{async *[Symbol.asyncIterator](){yield Buffer.alloc(65537,120);}}};
    if(httpFailureAt===chats)return {...response({error:'public mock failure'}),ok:false,status:503};
    const prompt=request.messages[0].content;let findings=[];
    if(prompt.includes('+console.log(request.headers.authorization);'))findings=[{path:'src/handler.js',line:1,severity:'high',summary:'Authorization credentials reach logs.',evidence:'`console.log(request.headers.authorization);`',proposedFix:'Do not log credentials.'}];
    if(prompt.includes('+exec(userInput);'))findings=[{path:'src/exec.js',line:2,severity:'high',summary:'Untrusted shell command.',evidence:'`exec(userInput);`',proposedFix:'Avoid the shell and validate arguments.'}];
    if(missControl)findings=[];
    if(echoAt===chats)findings=[{path:'tests/ai09-pr-review-automation.test.mjs',line:440,severity:'medium',summary:'Impact: bounded example still needs independent verification.',evidence:'`export const value = 1;`',proposedFix:'Verify this claim with independent behavior evidence.'}];
    if(badAt===chats)return response({model:'qwen3:1.7b',done:true,done_reason:'stop',message:{content:'{broken'},prompt_eval_count:100,eval_count:5});
    return response({model:'qwen3:1.7b',done:true,done_reason:cutoff?'length':'stop',message:{content:JSON.stringify({verdict:findings.length?'CHANGES_REQUESTED':'NO_FINDINGS',findings})},prompt_eval_count:100,eval_count:20});
  };
  return {call,get chats(){return chats;},requests};
}
function response(data){const b=Buffer.from(JSON.stringify(data));return {ok:true,status:200,body:{async *[Symbol.asyncIterator](){yield b;}}};}
test('moving profile parent leaves frozen review head and all prompt source bytes unchanged',async()=>{
  assert.equal(PROFILE.parentSha,'aeaa95e500e8318d0b7aa5a452af45c2b92a324b');
  const api=mockApi(),p=await runQualification({comparison,fetchImpl:api.call,checkpoint:()=>{},provenance:{runId:100,sourceHead}});
  assert.equal(p.reviewHead,'af2beb1a30237d2d7543841f9b0006c34afc76dc');
  assert.ok(api.requests.every(r=>r.messages[0].content.includes('Head commit: af2beb1a30237d2d7543841f9b0006c34afc76dc')));
  assert.equal(p.patchSha256,'56aefc367cfd749966a0566e25b65a5a7fb5e26ca4d4c42632338b231c53a419');
});
test('all qualification files fit unchanged native review budgets with frozen5 chunks reserved',()=>{
  const files=PROFILE.files.map(filename=>{const text=readFileSync(new URL('../'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
    const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();return {filename,additions:lines.length,deletions:0,changes:lines.length,
      patch:'@@ -0,0 +1,'+lines.length+' @@\n'+lines.map(line=>'+'+line).join('\n')};});
  const own=compareToReviewChunks({status:'ahead',ahead_by:1,total_commits:1,files},'99d4e1568fa15c7cab48fc343cd5521c0f8c9512',sourceHead);
  assert.ok(own.chunks.length+5<=24);assert.equal(buildCases(comparison).filter(c=>c.kind==='source').length,5);
});
test('8 mocked model requests retain raw bytes, identities and false authority',async()=>{
  const api=mockApi(),snapshots=[];
  const p=await runQualification({comparison,fetchImpl:api.call,checkpoint:s=>snapshots.push(JSON.parse(JSON.stringify(s))),provenance:{runId:100,sourceHead}});
  assert.equal(api.chats,8);assert.equal(p.status,'CANDIDATE_MEASURED');assert.equal(p.outcomes.length,8);
  assert.equal(p.mergeAuthorized,false);assert.equal(p.githubApprovalSatisfied,false);assert.equal(p.formalReviewAccepted,false);
  for(const c of p.calls){assert.equal(c.response.complete,true);assert.equal(c.request.sha256,sha(Buffer.from(c.request.base64,'base64')));assert.equal(c.response.sha256,sha(Buffer.from(c.response.base64,'base64')));}
  assert.ok(snapshots.some(s=>s.calls.at(-1)?.response.complete===false&&s.calls.at(-1)?.response.byteLength>0));
  assert.ok(api.requests.slice(0,3).every(r=>!r.messages[0].content.includes('expected')));
});
test('running-model identity bodies checkpoint bounded current prefix before EOF',async()=>{
  const api=mockApi();let latest,observed=0;
  const call=async(url,options)=>{
    const r=await api.call(url,options);if(!url.endsWith('/ps'))return r;
    const b=Buffer.from(JSON.stringify({models:[{name:'qwen3:1.7b',digest:PROFILE.modelDigest,context_length:8192}]}));
    return {...r,body:{async *[Symbol.asyncIterator](){yield b.subarray(0,10);
      const current=latest.identityPackets.at(-1);
      assert.equal(current.path,'ps');assert.equal(current.byteLength,10);assert.equal(current.complete,false);observed++;
      yield b.subarray(10);}}};
  };
  const p=await runQualification({comparison,fetchImpl:call,checkpoint:p=>{latest=JSON.parse(JSON.stringify(p));},provenance:{runId:100,sourceHead}});
  assert.equal(p.status,'CANDIDATE_MEASURED');assert.equal(observed,8);
});
for(const [name,options] of [['raw overflow',{overflowAt:3}],['HTTP failure',{httpFailureAt:3}]])test('preserve earlier2 raw responses and bounded failed third: '+name,async()=>{
  const api=mockApi(options),p=await runQualification({comparison,fetchImpl:api.call,checkpoint:()=>{},provenance:{runId:100,sourceHead}});
  assert.equal(p.status,'HOLD');assert.equal(api.chats,3);assert.equal(p.calls.length,3);assert.equal(p.calls[0].response.complete,true);
  assert.ok(p.calls[2].response.byteLength<=65536);assert.ok(p.calls[2].response.byteLength>0);
  if(options.overflowAt)assert.equal(p.calls[2].response.complete,false);
});
for(const [name,options] of [['missed control',{missControl:true}],['fixture echo',{echoAt:8}]])test('complete8 transport calls never mask bad controls or ungrounded source: '+name,async()=>{
  const api=mockApi(options),p=await runQualification({comparison,fetchImpl:api.call,checkpoint:()=>{},provenance:{runId:100,sourceHead}});
  assert.equal(api.chats,8);assert.equal(p.status,'HOLD');assert.equal(p.formalReviewAccepted,false);
  if(options.echoAt){assert.equal(p.outcomes.at(-1).findings.length,1);assert.equal(p.outcomes.at(-1).anchorAudit.complete,false);}
});
for(const [name,options] of [['invalid JSON',{badAt:3}],['length cutoff',{cutoff:true}],['model drift',{drift:true}]])test('HOLD with retained earlier/current evidence: '+name,async()=>{
  const api=mockApi(options);const p=await runQualification({comparison,fetchImpl:api.call,checkpoint:()=>{},provenance:{runId:100,sourceHead}});
  assert.equal(p.status,'HOLD');assert.ok(api.chats<=3);assert.ok(p.calls.length>=1);assert.ok(p.calls[0].response.byteLength>0);assert.equal(p.formalReviewAccepted,false);
});
test('workflow is read-only exact-head one-shot and retains bounded packet on failure',()=>{
  const text=readFileSync(new URL('../.github/workflows/goriq-ai09-public-qualification.yml',import.meta.url),'utf8');
  assert.match(text,/types: \[synchronize\]/);assert.match(text,/contents: read/);assert.doesNotMatch(text,/(pull_request_target|workflow_dispatch|secrets\.|permissions:\s*write|contents: write)/);
  assert.match(text,/ref: \$\{\{ github.event.pull_request.head.sha \}\}/);assert.match(text,/cancel-in-progress: false/);assert.match(text,/timeout-minutes: 35/);
  assert.match(text,/if: always\(\)/);assert.match(text,/retention-days: 7/);assert.match(text,/--max-time 240/);assert.match(text,/timeout 480s ollama pull qwen3:1.7b/);
});
