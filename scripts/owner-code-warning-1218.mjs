import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,mkdirSync,openSync,writeFileSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,dirname,join,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';

export const WARNING_SOURCE_FILES=Object.freeze(['scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1']);
const fields=['schemaVersion','scopeId','authorityType','issuedBy','issue','goalId','operation','ownerSid','sourceRevision','sourceHashes','workflowRunId','workflowRunAttempt','issuedAt','expiresAt','maxAttempts','maxDurationSeconds','allowedUiAction','controlled'];
const bools=['sourceHashesVerified','actualWindowsOwnerContextVerified','originalFormShown','originalWarningVisible','warningBeforeAnyConfirmation','originalCancelControlObserved','defaultCancelObserved','cancelInvoked','cancelledWithoutConfirmation','formDisposed','deadlineRespected','childCleanupVerified'];
const codes=['WARNING_CONTEXT_REQUIRED','WARNING_SCOPE_REQUIRED','WARNING_SOURCE_REJECTED','WARNING_ATTEMPT_CONSUMED','WARNING_OWNER_CONTEXT_REQUIRED','WARNING_UI_UNVERIFIED','WARNING_TIMEOUT','WARNING_PROTOCOL_FAILED','WARNING_CHILD_UNAVAILABLE','WARNING_CLEANUP_FAILED'];
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),outer=Date.parse('2026-11-10T08:00:00.000Z');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=v=>createHash('sha256').update(v).digest('hex');
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const fail=code=>{throw Error(code);};
function context(env){if(env.GITHUB_ACTOR!=='haji84'||env.GITHUB_REPOSITORY!=='haji84/AI-'||env.GITHUB_REF!=='refs/heads/main'||!hex(env.GITHUB_SHA,40)||typeof env.GITHUB_RUN_ID!=='string'||!/^\d+$/.test(env.GITHUB_RUN_ID)||env.GITHUB_RUN_ATTEMPT!=='1')fail('WARNING_CONTEXT_REQUIRED');}
export function validateWarningScope(s,env=process.env,now=Date.now()){
 context(env);if(!exact(s,fields)||typeof s.ownerSid!=='string'||typeof s.issuedAt!=='string'||typeof s.expiresAt!=='string')fail('WARNING_SCOPE_REQUIRED');
 const issued=Date.parse(s.issuedAt),expires=Date.parse(s.expiresAt);
 if(s.schemaVersion!==1||s.scopeId!=='issue:1218:owner-warning-only'||s.authorityType!=='TASK_SCOPED_ORDINARY_COMPLETION_DELEGATION'||s.issuedBy!=='task-delegated-operator'||s.issue!==1218||s.goalId!=='goal-fcc81c97e09153f7'||s.operation!=='warning-render-and-cancel-only'||!/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(s.ownerSid)||s.sourceRevision!==env.GITHUB_SHA||s.workflowRunId!==env.GITHUB_RUN_ID||!/^\d+$/.test(s.workflowRunId)||s.workflowRunAttempt!==1||s.maxAttempts!==1||s.maxDurationSeconds!==30||s.allowedUiAction!=='OwnerRotationCancel'||s.controlled!==false||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires-now<30000||expires-issued>900000||expires<=issued||expires>outer||!exact(s.sourceHashes,WARNING_SOURCE_FILES)||WARNING_SOURCE_FILES.some(k=>!hex(s.sourceHashes[k],64)))fail('WARNING_SCOPE_REQUIRED');
 return s;
}
export function bindWarningScope(descriptor,env=process.env,now=Date.now()){context(env);const s={...descriptor};if(s.workflowRunId==='BIND_CURRENT_GITHUB_RUN')s.workflowRunId=env.GITHUB_RUN_ID;return validateWarningScope(s,env,now);}
export function serializeWarningScope(s){const canonical=Object.fromEntries(fields.map(k=>[k,s[k]]));canonical.sourceHashes=Object.fromEntries(WARNING_SOURCE_FILES.map(k=>[k,s.sourceHashes[k]]));return JSON.stringify(canonical);}
export function buildWarningChildEnvironment(source,boundScope,deadline){
 const allowed=new Set(['SYSTEMROOT','WINDIR','SYSTEMDRIVE','PATH','PATHEXT','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PSMODULEPATH','OS','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','COMMONPROGRAMFILES','COMMONPROGRAMFILES(X86)','GITHUB_ACTOR','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_WORKSPACE']);
 const env={};for(const key of Object.keys(source))if(allowed.has(key.toUpperCase()))env[key]=source[key];
 env.GORIQ_OWNER_WARNING_SCOPE_BASE64=boundScope;env.GORIQ_OWNER_WARNING_DEADLINE_UTC=deadline;return env;
}
export function reserveWarningAttempt(checkout,scopeHash,revision,runId){
 if(!hex(scopeHash,64)||!hex(revision,40)||typeof runId!=='string'||!/^\d+$/.test(runId))fail('WARNING_SCOPE_REQUIRED');
 const directory=join(checkout,'.gai-results');try{mkdirSync(directory);}catch(error){if(error.code!=='EEXIST')throw error;}
 if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()||realpathSync.native(directory).toLowerCase()!==resolve(directory).toLowerCase())fail('WARNING_SOURCE_REJECTED');
 let fd;try{fd=openSync(join(directory,'owner-warning-1218.attempt'),'wx',0o600);}catch(error){if(error.code==='EEXIST')fail('WARNING_ATTEMPT_CONSUMED');throw error;}
 try{writeFileSync(fd,JSON.stringify({schemaVersion:1,runtimeScopeSha256:scopeHash,sourceRevision:revision,workflowRunId:runId,stage:'reserved'}));}finally{closeSync(fd);}
}
function result(code){return {schemaVersion:1,issue:1218,operation:'warning-render-and-cancel-only',complete:false,failureCode:code,runtimeScopeSha256:null,sourceRevision:null,...Object.fromEntries(bools.map(k=>[k,false])),confirmEventObserved:false};}
export function validateWarningResult(r,worker=false){
 if(!exact(r,['schemaVersion','issue','operation','complete','failureCode','runtimeScopeSha256','sourceRevision',...bools,'confirmEventObserved'])||r.schemaVersion!==1||r.issue!==1218||r.operation!=='warning-render-and-cancel-only'||typeof r.complete!=='boolean'||bools.some(k=>typeof r[k]!=='boolean')||typeof r.confirmEventObserved!=='boolean'||!(r.failureCode===null||codes.includes(r.failureCode))||!(r.runtimeScopeSha256===null||hex(r.runtimeScopeSha256,64))||!(r.sourceRevision===null||hex(r.sourceRevision,40)))fail('WARNING_PROTOCOL_FAILED');
 if(r.complete&&(r.failureCode!==null||r.confirmEventObserved||!hex(r.runtimeScopeSha256,64)||!hex(r.sourceRevision,40)||bools.filter(k=>!worker||k!=='childCleanupVerified').some(k=>!r[k])))fail('WARNING_PROTOCOL_FAILED');
 if(!r.complete&&r.failureCode===null)fail('WARNING_PROTOCOL_FAILED');return r;
}

// Dependency injection is a module API for public process fixtures, never a CLI
// or environment switch. Production always supplies the fixed native worker.
export async function runBoundedWarningChild(factory,{durationMs=30000,runtimeScopeSha256,sourceRevision,clock=Date.now}){
 if(!Number.isInteger(durationMs)||durationMs<=0||durationMs>30000)fail('WARNING_SCOPE_REQUIRED');
 return await new Promise(resolveResult=>{
  let child,output='',bytes=0,problem=null,settled=false;const started=clock();
  const finish=(r,closed)=>{if(settled)return;settled=true;clearTimeout(killTimer);clearTimeout(hardTimer);r.childCleanupVerified=closed;r.deadlineRespected=r.deadlineRespected&&clock()-started<=durationMs;if(r.complete&&!r.deadlineRespected){r.complete=false;r.failureCode='WARNING_TIMEOUT';}resolveResult(r);};
  const abort=code=>{if(!problem)problem=code;try{child?.kill();}catch{}};
  const killTimer=setTimeout(()=>abort('WARNING_TIMEOUT'),Math.max(1,durationMs-500));
  const hardTimer=setTimeout(()=>{abort('WARNING_TIMEOUT');finish(result(problem),false);},durationMs);
  try{
   child=factory();child.stdout.setEncoding('utf8');
   child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>8192){abort('WARNING_PROTOCOL_FAILED');return;}output+=chunk;});
   child.stderr.on('data',()=>abort('WARNING_PROTOCOL_FAILED'));
   child.on('error',()=>{abort('WARNING_CHILD_UNAVAILABLE');});
   child.on('close',exit=>{
    if(problem){finish(result(problem),true);return;}
    try{const r=validateWarningResult(JSON.parse(output.trim()),true);if(output.trim().includes('\n')||exit!==(r.complete?0:1)||r.runtimeScopeSha256!==runtimeScopeSha256||r.sourceRevision!==sourceRevision)fail('WARNING_PROTOCOL_FAILED');finish(r,true);}catch{finish(result('WARNING_PROTOCOL_FAILED'),true);}
   });
  }catch{abort('WARNING_CHILD_UNAVAILABLE');finish(result('WARNING_CHILD_UNAVAILABLE'),false);}
 });
}

// Preparation copies only the approved public sources into a newly protected
// current-Owner directory. It never opens UI and has its own finite resource bound.
export async function runBoundedWarningPreparation(factory,{durationMs=30000,clock=Date.now}={}){
 if(!Number.isInteger(durationMs)||durationMs<=0||durationMs>30000)fail('WARNING_SCOPE_REQUIRED');
 return await new Promise(done=>{
  const started=clock();let child,output='',bytes=0,problem=null,settled=false;const failed=code=>({schemaVersion:1,complete:false,failureCode:code,profileMatchesEnvironment:false});
  const finish=record=>{if(settled)return;settled=true;clearTimeout(kill);clearTimeout(hard);done(record.complete&&clock()-started>durationMs?failed('WARNING_TIMEOUT'):record);};const stop=code=>{problem??=code;try{child?.kill();}catch{}};
  const kill=setTimeout(()=>stop('WARNING_TIMEOUT'),Math.max(1,durationMs-500)),hard=setTimeout(()=>{stop('WARNING_TIMEOUT');finish(failed(problem));},durationMs);
  try{
   child=factory();child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>1024){stop('WARNING_PROTOCOL_FAILED');return;}output+=chunk;});child.stderr.on('data',()=>stop('WARNING_PROTOCOL_FAILED'));child.on('error',()=>{stop('WARNING_CHILD_UNAVAILABLE');finish(failed(problem));});
   child.on('close',exit=>{
    if(problem){finish(failed(problem));return;}
    try{const r=JSON.parse(output.trim());if(output.trim().includes('\n')||!exact(r,['schemaVersion','complete','failureCode','profileMatchesEnvironment'])||r.schemaVersion!==1||typeof r.complete!=='boolean'||typeof r.profileMatchesEnvironment!=='boolean'||exit!==(r.complete?0:1)||r.complete&&(r.failureCode!==null||!r.profileMatchesEnvironment)||!r.complete&&!codes.includes(r.failureCode))fail('WARNING_PROTOCOL_FAILED');finish(r);}catch{finish(failed('WARNING_PROTOCOL_FAILED'));}
   });
  }catch{stop('WARNING_CHILD_UNAVAILABLE');finish(failed(problem));}
 });
}

function regular(path,limit){const m=lstatSync(path);if(!m.isFile()||m.isSymbolicLink()||m.size>limit||realpathSync.native(path).toLowerCase()!==resolve(path).toLowerCase())fail('WARNING_SOURCE_REJECTED');return readFileSync(path);}
async function run(){
 let scope,scopeHash;
 try{
  if(process.platform!=='win32'||resolve(process.cwd()).toLowerCase()!==root.toLowerCase())fail('WARNING_CONTEXT_REQUIRED');context(process.env);
  const encoded=process.env.GORIQ_OWNER_WARNING_SCOPE_BASE64??'';if(encoded.length>32768||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail('WARNING_SCOPE_REQUIRED');
  const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)fail('WARNING_SCOPE_REQUIRED');
  scope=bindWarningScope(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  for(const file of WARNING_SOURCE_FILES)if(hash(regular(join(root,file),262144))!==scope.sourceHashes[file])fail('WARNING_SOURCE_REJECTED');
  const serialized=serializeWarningScope(scope);scopeHash=hash(serialized);
  reserveWarningAttempt(root,scopeHash,scope.sourceRevision,scope.workflowRunId);
  const executable=win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),boundScope=Buffer.from(serialized).toString('base64');
  const prepared=await runBoundedWarningPreparation(()=>spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',join(root,'scripts','owner-code-warning-1218.ps1'),'-Prepare'],{windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:root,env:buildWarningChildEnvironment(process.env,boundScope,'')}));
  if(!prepared.complete)fail(prepared.failureCode);
  const stage=win32.join(process.env.USERPROFILE,`.goriq-owner-warning-1218-${scope.workflowRunId}-${scope.workflowRunAttempt}-${scopeHash}`);
  for(const file of WARNING_SOURCE_FILES)if(hash(regular(win32.join(stage,file),262144))!==scope.sourceHashes[file])fail('WARNING_SOURCE_REJECTED');
  const deadline=Date.now()+30000;
  return await runBoundedWarningChild(()=>spawn(executable,['-NoLogo','-NoProfile','-STA','-NonInteractive','-File',win32.join(stage,'scripts','owner-code-warning-1218.ps1'),'-Run'],{windowsHide:false,stdio:['ignore','pipe','pipe'],cwd:stage,env:buildWarningChildEnvironment(process.env,boundScope,new Date(deadline).toISOString())}),{durationMs:30000,runtimeScopeSha256:scopeHash,sourceRevision:scope.sourceRevision});
 }catch(error){const r=result(codes.includes(error.message)?error.message:'WARNING_SCOPE_REQUIRED');r.runtimeScopeSha256=scopeHash??null;r.sourceRevision=scope?.sourceRevision??null;return r;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===2)console.log('PLAN ONLY: warning-and-Cancel requires a fresh ordinary task scope; no Owner state or UI is accessed.');
 else{const r=process.argv.length===3&&process.argv[2]==='--run'?await run():result('WARNING_CONTEXT_REQUIRED');console.log(JSON.stringify(r));if(!r.complete)process.exitCode=1;}
}
