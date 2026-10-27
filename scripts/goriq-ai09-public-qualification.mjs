// UNAPPLIED public experiment. Never formal AI09 approval or a default-model change.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {compareToReviewChunks} from '../src/orchestrator/ai09-pr-review-automation.mjs';
import {reviewLocalPatch} from '../src/orchestrator/ai09-local-reviewer.mjs';
import {anchorAudit} from './goriq-ai09-finding-anchors.mjs';

const REPO='haji84/AI-', OWNER='haji84', PR=1868, SCOPE_COMMENT=6431546532;
const BASE='99d4e1568fa15c7cab48fc343cd5521c0f8c9512';
const PATCH='56aefc367cfd749966a0566e25b65a5a7fb5e26ca4d4c42632338b231c53a419';
const MODEL='qwen3:1.7b', LOCAL='http://127.0.0.1:11434/api/';
const WORKFLOW='.github/workflows/goriq-ai09-public-qualification.yml';
export const PROFILE=Object.freeze({parentSha:'af2beb1a30237d2d7543841f9b0006c34afc76dc',
  modelDigest:'8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7',
  files:Object.freeze([WORKFLOW,'scripts/goriq-ai09-public-qualification.mjs','tests/ai09-public-qualification.test.mjs'])});
const digest=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const SOURCE_PATHS=['docs/jarvis-reverse-traceability.json','scripts/goriq-ai09-finding-anchors.mjs',
  'src/orchestrator/ai09-pr-review-automation.mjs','tests/ai09-finding-anchors.test.mjs','tests/ai09-pr-review-automation.test.mjs'];
const controls=[
  {path:'src/arithmetic.js',patch:'@@ -0,0 +1 @@\n+export function add(a, b) { return a + b; }',expected:'NO_ACTIONABLE_FINDINGS'},
  {path:'src/handler.js',patch:'@@ -0,0 +1 @@\n+console.log(request.headers.authorization);',expected:'CHANGES_REQUESTED'},
  {path:'src/exec.js',patch:"@@ -0,0 +1,2 @@\n+import { exec } from 'node:child_process';\n+exec(userInput);",expected:'CHANGES_REQUESTED'}
];

export function buildCases(comparison){
  let plan;try{plan=compareToReviewChunks(comparison,BASE,PROFILE.parentSha);}catch{throw Error('SOURCE_PLAN_INVALID');}
  if(plan.patchSha256!==PATCH||plan.chunks.length!==5||!same(plan.paths,SOURCE_PATHS))throw Error('SOURCE_PLAN_MISMATCH');
  return controls.map((c,i)=>({id:'control-'+(i+1),kind:'control',paths:[c.path],expected:c.expected,
    patch:'diff --git a/'+c.path+' b/'+c.path+'\n'+c.patch})).concat(plan.chunks.map((c,i)=>({
      id:'source-'+(i+1),kind:'source',paths:c.paths,patch:c.patch})));
}

export function validateAuthorization(comment,event,env,profile){
  if(env.GITHUB_EVENT_NAME!=='pull_request'||env.GITHUB_REPOSITORY!==REPO||env.GITHUB_RUN_ATTEMPT!=='1'||
    env.RUNNER_OS!=='Linux'||env.RUNNER_ARCH!=='X64'||env.GITHUB_ACTOR!==OWNER||
    event?.action!=='synchronize'||event.number!==PR||event.sender?.login!==OWNER||
    event.repository?.full_name!==REPO||event.repository.private!==false||event.pull_request?.number!==PR||
    event.pull_request.head?.repo?.full_name!==REPO||event.pull_request.base?.repo?.full_name!==REPO||event.pull_request.base.ref!=='main'||
    !/^[a-f0-9]{40}$/.test(profile?.head??'')||event.pull_request.head.sha!==profile.head||profile.parent!==PROFILE.parentSha||profile.dirty!==false||
    !Array.isArray(profile.files)||profile.files.length!==3||
    !same(profile.files.map(f=>f.path).sort(),[...PROFILE.files].sort())||
    profile.files.some(f=>f.status!=='A'||f.mode!=='100644'||!/^[a-f0-9]{64}$/.test(f.sha256)))throw Error('SOURCE_REJECTED');
  let a;
  try{
    const blocks=[...comment.body.matchAll(/<!-- AI09_PUBLIC_QUALIFICATION_SCOPE -->\s*```json\s*([\s\S]*?)```/g)];
    if(comment.user?.login!==OWNER||comment.user.type!=='User'||blocks.length!==1)throw Error();
    a=JSON.parse(blocks[0][1]);
    const storage=a.storageZeroChargeEvidence;
    if(a.schemaVersion!==1||a.status!=='APPROVED_BY_OWNER_CHAT'||a.repository!==REPO||a.prNumber!==PR||a.parentSha!==PROFILE.parentSha||
      !/^[a-f0-9]{64}$/.test(a.patchSha256??'')||a.patchSha256!==profile.patchSha256||
      !same(Object.keys(a.files).sort(),[...PROFILE.files].sort())||profile.files.some(f=>a.files[f.path]!==f.sha256)||
      storage?.method!=='OWNER_VERIFIED_EXISTING_HARD_STOP'||storage.verifiedBy!==OWNER||storage.maximumCharge!==0||
      !Number.isFinite(Date.parse(storage.verifiedAt))||!/^https:\/\/github\.com\/settings\/billing(?:\/|$)/.test(storage.url??'')||
      !same([...storage.covers].sort(),['artifacts','logs']))throw Error();
  }catch{throw Error('AUTHORIZATION_MISSING_OR_MISMATCH');}
  return a;
}

export function validateRunHistory(pages,runId,head){
  const total=pages[0]?.total_count;
  const runs=pages.flatMap(p=>p.workflow_runs??[]);
  const current=runs.filter(r=>r.id===runId);
  if(!Number.isSafeInteger(total)||total<1||total>1000||pages.some(p=>p.total_count!==total)||runs.length!==total||
    new Set(runs.map(r=>r.id)).size!==total||current.length!==1||
    current[0].head_sha!==head||current[0].event!=='pull_request'||current[0].run_attempt!==1||
    current[0].repository?.full_name!==REPO||current[0].path!==WORKFLOW||current[0].run_number!==1||
    runs.some(r=>r.workflow_id!==current[0].workflow_id||r.path!==WORKFLOW||!Number.isSafeInteger(r.run_number)||
      r.run_number<current[0].run_number))throw Error('RUN_HISTORY_REJECTED');
}

export async function readBounded(response,limit,progress=()=>{}){
  const parts=[];let length=0;
  const snapshot=(complete,error=null)=>{const b=Buffer.concat(parts);return {base64:b.toString('base64'),byteLength:length,sha256:digest(b),complete,...(error?{error}:{})};};
  try{
    if(!response.body)throw Error();
    for await(const chunk of response.body){
      const b=Buffer.from(chunk),take=Math.min(b.length,limit-length);
      if(take){parts.push(b.subarray(0,take));length+=take;}
      progress(snapshot(false));
      if(take!==b.length)return snapshot(false,'BODY_LIMIT_EXCEEDED');
    }
    return snapshot(true);
  }catch{return snapshot(false,'BODY_READ_FAILED');}
}

export function modelIdentity(data,running=false){
  const models=data?.models;
  if(!Array.isArray(models)||models.length!==1||models[0].name!==MODEL||models[0].digest!==PROFILE.modelDigest||
    (running&&models[0].context_length!==8192))throw Error('MODEL_IDENTITY_MISMATCH');
  return models[0].digest;
}

export async function runQualification({comparison,fetchImpl=fetch,checkpoint=()=>{},provenance}){
  const cases=buildCases(comparison);
  if(!Number.isSafeInteger(provenance?.runId)||!/^[a-f0-9]{40}$/.test(provenance?.sourceHead??''))throw Error('SOURCE_PROVENANCE_INVALID');
  const packet={schemaVersion:1,experiment:'public-candidate-qualification-not-formal-ai09',status:'HOLD',repository:REPO,prNumber:PR,
    provenance,baseSha:BASE,reviewHead:PROFILE.parentSha,patchSha256:PATCH,model:MODEL,modelDigest:PROFILE.modelDigest,
    planSha256:digest(JSON.stringify(cases)),startedAt:new Date().toISOString(),completedAt:null,
    limits:{calls:8,requestTimeoutMs:90000,responseBytes:65536,numCtx:8192,numPredict:1536,retries:0},
    calls:[],outcomes:[],identityPackets:[],blockers:[],evidenceClass:'AI_ASSERTED',
    githubApprovalSatisfied:false,mergeAuthorized:false,formalReviewAccepted:false,humanGateBypassed:false};
  const save=()=>checkpoint(packet);
  async function local(path,request,onProgress){
    const response=await fetchImpl(LOCAL+path,{method:request?'POST':'GET',redirect:'error',
      headers:{'Content-Type':'application/json'},...(request?{body:request}:{}),signal:AbortSignal.timeout(request?90000:5000)});
    const body=await readBounded(response,65536,onProgress);
    if(!body.complete||!response.ok)return {body,value:null,error:body.error??'HTTP_RESPONSE_REJECTED'};
    try{return {body,value:JSON.parse(Buffer.from(body.base64,'base64').toString('utf8'))};}
    catch{return {body,value:null,error:'API_JSON_INVALID'};}
  }
  async function identity(path,running=false){
    const record={path,base64:'',byteLength:0,sha256:digest(''),complete:false};
    packet.identityPackets.push(record);save();
    const r=await local(path,undefined,body=>{Object.assign(record,body);save();});
    Object.assign(record,r.body);save();
    if(r.error)throw Error('MODEL_IDENTITY_UNAVAILABLE');
    if(path==='version'){if(r.value?.version!=='0.34.0')throw Error('MODEL_SERVER_VERSION_MISMATCH');}
    else modelIdentity(r.value,running);
  }
  save();
  try{
    await identity('version');await identity('tags');
    for(const c of cases){
      const review=await reviewLocalPatch({baseSha:BASE,headSha:PROFILE.parentSha,makerRole:'Builder',paths:c.paths,patch:c.patch,
        infer:async prompt=>{
          if(packet.calls.length>=8)throw Error('CALL_LIMIT');
          const request=Buffer.from(JSON.stringify({model:MODEL,think:false,stream:false,format:'json',keep_alive:'5m',
            options:{temperature:0,num_ctx:8192,num_predict:1536},messages:[{role:'user',content:prompt}]}));
          const call={sequence:packet.calls.length+1,id:c.id,kind:c.kind,startedAt:new Date().toISOString(),completedAt:null,
            request:{base64:request.toString('base64'),byteLength:request.length,sha256:digest(request),complete:true},
            response:{base64:'',byteLength:0,sha256:digest(''),complete:false}};
          packet.calls.push(call);save();const start=performance.now();
          const r=await local('chat',request.toString('utf8'),body=>{call.response=body;save();});
          call.response=r.body;call.latencyMs=Math.round(performance.now()-start);call.completedAt=new Date().toISOString();
          call.doneReason=r.value?.done_reason??null;call.promptTokens=r.value?.prompt_eval_count??null;call.outputTokens=r.value?.eval_count??null;
          save();
          if(r.error||r.value?.model!==MODEL||r.value?.done!==true||r.value?.done_reason!=='stop'||
            !Number.isSafeInteger(call.promptTokens)||call.promptTokens<0||call.promptTokens>8192||
            !Number.isSafeInteger(call.outputTokens)||call.outputTokens<0||call.outputTokens>1536||
            typeof r.value?.message?.content!=='string')throw Error('MODEL_RESPONSE_REJECTED');
          await identity('ps',true);
          return r.value.message.content;
        }});
      const audit=anchorAudit(review.findings,c.patch);
      packet.outcomes.push({id:c.id,kind:c.kind,status:review.status,findings:review.findings,blockers:review.blockers,anchorAudit:audit,
        ...(c.kind==='control'?{expected:c.expected,matched:review.status===c.expected&&audit.complete}:{})});save();
      if(review.status==='BLOCKED')throw Error('MODEL_CALL_OR_PARSE_FAILED');
    }
    await identity('tags');
    if(packet.calls.length===8&&packet.calls.every(c=>c.response.complete&&c.completedAt)&&packet.outcomes.length===8&&
      packet.outcomes.every(o=>['NO_ACTIONABLE_FINDINGS','CHANGES_REQUESTED'].includes(o.status)&&o.anchorAudit.complete)&&
      packet.outcomes.filter(o=>o.kind==='control').every(o=>o.matched))packet.status='CANDIDATE_MEASURED';
    else packet.blockers.push('CONTROL_OR_SOURCE_REQUIRES_TRIAGE');
  }catch{packet.status='HOLD';packet.blockers.push('INCOMPLETE_OR_INVALID_EXPERIMENT');}
  packet.completedAt=new Date().toISOString();save();return packet;
}

const git=args=>execFileSync('git',args,{maxBuffer:256*1024,windowsHide:true});
function actualProfile(){
  const head=git(['rev-parse','HEAD']).toString('utf8').trim();
  const parents=git(['show','-s','--format=%P','HEAD']).toString('utf8').trim().split(' ');
  const entries=git(['diff','--name-status','--no-renames',PROFILE.parentSha,head]).toString('utf8').trim().split('\n');
  return {head,parent:parents.length===1?parents[0]:null,dirty:git(['status','--porcelain','--untracked-files=no']).length!==0,
    patchSha256:digest(git(['diff','--binary','--full-index','--no-ext-diff','--no-textconv',PROFILE.parentSha,head])),
    files:entries.map(line=>{const [status,path]=line.split('\t');return {status,path,
      mode:git(['ls-tree',head,'--',path]).toString('utf8').split(' ')[0],sha256:digest(git(['show',head+':'+path]))};})};
}
async function publicJson(path){
  const r=await fetch('https://api.github.com/repos/'+REPO+path,{redirect:'error',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
  const body=await readBounded(r,256*1024);
  if(!r.ok||!body.complete)throw Error('PUBLIC_SOURCE_UNAVAILABLE');
  return JSON.parse(Buffer.from(body.base64,'base64').toString('utf8'));
}
async function preflight(){
  const env=process.env, event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')),profile=actualProfile();
  const authorization=validateAuthorization(await publicJson('/issues/comments/'+SCOPE_COMMENT),event,env,profile);
  const pages=[];
  for(let page=1;page<=10;page++){
    const p=await publicJson('/actions/workflows/goriq-ai09-public-qualification.yml/runs?per_page=100&page='+page);
    pages.push(p);if(pages.reduce((n,p)=>n+(p.workflow_runs?.length??0),0)>=p.total_count)break;
  }
  const runId=Number(env.GITHUB_RUN_ID);validateRunHistory(pages,runId,profile.head);
  return {runId,sourceHead:profile.head,profilePatchSha256:profile.patchSha256,scopeComment:SCOPE_COMMENT,
    authorizationSha256:digest(JSON.stringify(authorization)),runnerOs:env.RUNNER_OS,runnerArch:env.RUNNER_ARCH,
    workflowRef:env.GITHUB_WORKFLOW_REF,workflowSha:env.GITHUB_WORKFLOW_SHA,verifiedAt:new Date().toISOString()};
}
function writePacket(path,value){
  const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>2*1024*1024)throw Error('PACKET_LIMIT');
  writeFileSync(path+'.tmp',bytes,{mode:0o600});renameSync(path+'.tmp',path);
}
async function main(){
  const mode=process.argv[2];if(!['prepare','run'].includes(mode))throw Error('MODE_REJECTED');
  const root=resolve(process.env.RUNNER_TEMP??'');if(!process.env.RUNNER_TEMP)throw Error('RUNNER_TEMP_REQUIRED');
  const input=join(root,'ai09-public-qualification-input.json'),output=join(root,'ai09-public-qualification-packet.json');
  const provenance=await preflight();
  if(mode==='prepare'){
    if(existsSync(input)||existsSync(output))throw Error('EXPERIMENT_ALREADY_STARTED');
    const comparison=await publicJson('/compare/'+BASE+'...'+PROFILE.parentSha);buildCases(comparison);
    writeFileSync(input,JSON.stringify(comparison),{mode:0o600,flag:'wx'});
  }else{
    if(existsSync(output))throw Error('EXPERIMENT_ALREADY_STARTED');
    const b=readFileSync(input);if(b.length>256*1024)throw Error('SOURCE_INPUT_LIMIT');
    const p=await runQualification({comparison:JSON.parse(b.toString('utf8')),provenance,checkpoint:p=>writePacket(output,p)});
    console.log('AI09_PUBLIC_QUALIFICATION='+JSON.stringify({status:p.status,calls:p.calls.length,outcomes:p.outcomes.length,packetSha256:digest(readFileSync(output)),formalReviewAccepted:false}));
    if(p.status!=='CANDIDATE_MEASURED')process.exitCode=2;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('AI09_PUBLIC_QUALIFICATION_HOLD');process.exitCode=2;});
