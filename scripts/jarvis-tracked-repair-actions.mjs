import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import {gzipSync,gunzipSync,brotliCompressSync,brotliDecompressSync,constants as zlibConstants} from 'node:zlib';
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync,unlinkSync,appendFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {CompassStore} from '../src/compass/store.ts';
import {compassGoalToLoopGoal} from '../src/orchestrator/compass-state-store.ts';
import {goalWorkStateId} from '../src/orchestrator/work-state-integration.ts';
import {JsonFileDevelopmentJobStore} from '../src/orchestrator/development-job-store.ts';
import {JsonFileDevelopmentChangeSetStore} from '../src/orchestrator/development-change-set-store.ts';
import {readTrackedRepairManifest} from '../src/orchestrator/tracked-repair-resident-runtime.ts';
import {assertExternalRuntimePath} from '../src/orchestrator/resident-runtime-files.ts';

export const FIXED_ROOT='/tmp/goriq-1219-20261103';
const hash=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fail=()=>{throw Error('TRACKED_ACTIONS_CHECKPOINT_INVALID');};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const safe=p=>typeof p==='string'&&/^[A-Za-z0-9_./-]+$/.test(p)&&!p.split('/').some(x=>!x||x==='.'||x==='..')&&!p.startsWith('/');
const bounded=file=>{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>2097152||s.size<1)fail();return readFileSync(file);};
function cleanBytes(text){if(typeof text!=='string'||/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)||/"(?:JARVIS_OWNER_TOKEN|GITHUB_TOKEN|GH_TOKEN|privateKeyFile)"\s*:/.test(text))fail();}
function bytesFor(row){if(!plain(row)||Object.keys(row).sort().join(',')!=='contentBase64,path,sha256'||!safe(row.path)||!hex(row.sha256)||typeof row.contentBase64!=='string'||row.contentBase64.length>2796204)fail();
 const bytes=Buffer.from(row.contentBase64,'base64');if(bytes.toString('base64')!==row.contentBase64||!bytes.length||hash(bytes)!==row.sha256)fail();cleanBytes(bytes.toString('utf8'));return bytes;}
export function validateCheckpoint(cp,{now=Date.now(),expectedHead,phase}={}){
 if(!plain(cp)||Object.keys(cp).sort().join(',')!=='changeSetId,files,goalId,head,jobId,kind,manifestSha256,phase,sourceRunId,version'
  ||cp.version!==1||cp.kind!=='tracked-repair-actions-checkpoint'||!/^[a-f0-9]{40}$/.test(cp.head??'')||(expectedHead&&cp.head!==expectedHead)
  ||!['cloud','A','B'].includes(cp.phase)||!hex(cp.manifestSha256)||!['goalId','jobId','changeSetId'].every(k=>typeof cp[k]==='string'&&cp[k].length>0&&cp[k].length<=128)
  ||(cp.phase==='cloud'?cp.sourceRunId!==null:!/^\d+$/.test(cp.sourceRunId??''))||!Array.isArray(cp.files)||cp.files.length<8||cp.files.length>64)fail();
 if((phase==='A'&&cp.phase!=='cloud')||(phase==='B'&&cp.phase!=='A'))fail();
 const files=new Map();let total=0;for(const row of cp.files){const bytes=bytesFor(row);total+=bytes.length;if(files.has(row.path)||total>2097152)fail();files.set(row.path,bytes);}
 const json=p=>{if(!files.has(p))fail();try{return JSON.parse(files.get(p));}catch{fail();}};
 const m=json('manifest.json');
 if(m.recoveryAttempts!==undefined)throw Error('TRACKED_ACTIONS_RECOVERY_TRANSPORT_REQUIRED');
 if(hash(files.get('manifest.json'))!==cp.manifestSha256||m.version!==1||m.profile!=='tracked-source-repair-v1'||m.workspace!==FIXED_ROOT+'/candidate'||m.baselineWorkspace!==FIXED_ROOT+'/baseline'
  ||m.probe?.file!==FIXED_ROOT+'/frozen-probe.mjs'||m.verifier?.publicKeyFile!==FIXED_ROOT+'/public.pem'||m.verifier?.receiptFile!==FIXED_ROOT+'/receipt.json'
  ||!m.sequence||m.sequence.taskScopeId!=='issue:1219'||m.sequence.maxRisk!=='low'||m.sequence.completionMode!=='verified-local-artifact'||m.sequence.jobs?.length!==1
  ||!Number.isFinite(Date.parse(m.sequence.expiresAt))||Date.parse(m.sequence.expiresAt)<=now||!/^[a-f0-9]{40}$/.test(m.sequence.jobs[0].baseRevision??'')
  ||!Array.isArray(m.trackedFiles)||!m.trackedFiles.length||m.trackedFiles.length>8||!safe(m.probe?.targetPath))fail();
 if(m.bookkeeping&&(m.bookkeeping.path!=='docs/jarvis-reverse-traceability.json'||!hex(m.bookkeeping.beforeSha256)))fail();
 const declared=[...m.trackedFiles,...(m.bookkeeping?[m.bookkeeping]:[])];
 const allowed=new Set(['manifest.json','public.pem','frozen-probe.mjs','state/compass.sqlite','state/self-development/jobs.json','state/self-development/change-sets.json','receipt.json.request.json']);
 for(const f of m.trackedFiles){if(!safe(f.path)||! /^(src|scripts)\//.test(f.path)||!hex(f.beforeSha256))fail();allowed.add('candidate/'+f.path);}
 if(m.bookkeeping)allowed.add('candidate/'+m.bookkeeping.path);
 allowed.add('candidate/'+m.probe.targetPath);
 for(const p of files.keys())if(!allowed.has(p)&&!/^state\/self-development\/tracked-repair\/[a-f0-9]{64}\.(?:prepared\.json(?:\.intent\.json|\.response\.json)?|red\.json(?:\.log)?)$/.test(p))fail();
 for(const p of allowed)if(!files.has(p))fail();
 if(hash(files.get('public.pem'))!==m.verifier.publicKeySha256||hash(files.get('frozen-probe.mjs'))!==m.probe.sha256||hash(files.get('candidate/'+m.probe.targetPath))!==m.probe.sha256)fail();
 const jobs=json('state/self-development/jobs.json').jobs,changes=json('state/self-development/change-sets.json').changeSets;
 if(!Array.isArray(jobs)||jobs.length!==1||jobs[0].jobId!==cp.jobId||jobs[0].goalId!==cp.goalId||jobs[0].baseRevision!==m.sequence.jobs[0].baseRevision||jobs[0].phase!==(cp.phase==='B'?'COMPLETED':'VERIFYING')||!Array.isArray(changes))fail();
 const change=changes.find(c=>c.changeSetId===cp.changeSetId);
 if(!change||change.jobId!==cp.jobId||!change.workItemId?.endsWith(':implement')||!hex(change.candidateRevision)||!hex(change.artifactDigest))fail();
 const req=json('receipt.json.request.json');
 if(req.version!==2||req.executionContractDigest!==cp.manifestSha256||req.request?.goalId!==cp.goalId||req.request?.jobId!==cp.jobId||req.request?.changeSetId!==cp.changeSetId
  ||req.request?.sourceRevision!==change.candidateRevision||req.request?.artifactDigest!==change.artifactDigest)fail();
 const prepared=json('state/self-development/tracked-repair/'+hash(cp.jobId)+'.prepared.json');
 if(prepared.binding!==hash(cp.manifestSha256+'\0'+cp.jobId)||!Array.isArray(prepared.files)||!prepared.files.length)fail();
 for(const f of prepared.files)if(!declared.some(p=>p.path===f.path)||typeof f.content!=='string'||!files.has('candidate/'+f.path)||hash(f.content)!==hash(files.get('candidate/'+f.path)))fail();
 return {manifest:m,files,change};
}
const mapPath='docs/jarvis-reverse-traceability.json',mapMarker='GORIQ_FIXED_TRACEABILITY_REFERENCE_V1';
function packFixedMap(cp){
 const m=JSON.parse(bytesFor(cp.files.find(r=>r.path==='manifest.json')));if(!m.bookkeeping)return null;
 const document=bytesFor(cp.files.find(r=>r.path==='candidate/'+mapPath)),docText=document.toString('utf8'),docBase64=document.toString('base64');
 const rows=cp.files.map(row=>{
  if(row.path==='candidate/'+mapPath)return {path:row.path,sha256:row.sha256,codec:'fixed-map'};
  if(!row.path.endsWith('.prepared.json')&&row.path!=='receipt.json.request.json')return row;
  const raw=bytesFor(row).toString('utf8'),suffix=raw.endsWith('\n')?'\n':'',value=JSON.parse(raw);
  if(JSON.stringify(value)+suffix!==raw)throw Error('TRACKED_ACTIONS_NONCANONICAL_JOURNAL');
  const entries=value.files?.filter(f=>f.path===mapPath);if(entries?.length!==1)fail();
  const codec=row.path.endsWith('.prepared.json')?'prepared-map':'outbox-map',field=codec==='prepared-map'?'content':'contentBase64';
  if(entries[0][field]!== (field==='content'?docText:docBase64))fail();entries[0][field]=mapMarker;
  return {path:row.path,sha256:row.sha256,codec,suffix,contentBase64:Buffer.from(JSON.stringify(value)).toString('base64')};
 });
 return {version:2,kind:'tracked-repair-actions-fixed-map',checkpoint:{...cp,files:rows}};
}
function unpackFixedMap(wire,{bookkeepingBaseline}={}){
 if(!plain(wire)||Object.keys(wire).sort().join(',')!=='checkpoint,kind,version'||wire.version!==2||wire.kind!=='tracked-repair-actions-fixed-map'||!plain(wire.checkpoint)||!Array.isArray(wire.checkpoint.files)||wire.checkpoint.files.length>64)fail();
 const cp=wire.checkpoint,m=JSON.parse(bytesFor(cp.files.find(r=>r.path==='manifest.json'))),base=m.sequence?.jobs?.[0]?.baseRevision;
 if(m.bookkeeping?.path!==mapPath||!hex(m.bookkeeping.beforeSha256)||!/^[a-f0-9]{40}$/.test(base??'')||!Array.isArray(m.trackedFiles)||!m.trackedFiles.length||m.trackedFiles.length>8)fail();
 const baseline=bookkeepingBaseline??execFileSync('git',['cat-file','blob',base+':'+mapPath],{maxBuffer:1048577,timeout:15000,
  env:{PATH:process.env.PATH,HOME:process.env.HOME,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});
 if(!Buffer.isBuffer(baseline)||baseline.length>1048576||hash(baseline)!==m.bookkeeping.beforeSha256)fail();
 const document=JSON.parse(baseline);if(!Array.isArray(document.surfaces))fail();
 for(const source of m.trackedFiles){
  if(!safe(source.path)||! /^(src|scripts)\//.test(source.path)||!hex(source.beforeSha256))fail();
  const rows=document.surfaces.filter(row=>row?.path===source.path);if(rows.length!==1||rows[0].sha256!==source.beforeSha256)fail();
  rows[0].sha256=hash(bytesFor(cp.files.find(r=>r.path==='candidate/'+source.path)));
 }
 const doc=Buffer.from(JSON.stringify(document,null,2)+'\n');if(doc.length>1048576)fail();
 const rows=cp.files.map(row=>{
  if(!row.codec)return row;
  if(!safe(row.path)||!hex(row.sha256))fail();let bytes;
  if(row.codec==='fixed-map'&&row.path==='candidate/'+mapPath&&Object.keys(row).sort().join(',')==='codec,path,sha256')bytes=doc;
  else{
   if(Object.keys(row).sort().join(',')!=='codec,contentBase64,path,sha256,suffix'||!['','\n'].includes(row.suffix)||typeof row.contentBase64!=='string'||row.contentBase64.length>2796204)fail();
   const packed=Buffer.from(row.contentBase64,'base64');if(packed.toString('base64')!==row.contentBase64)fail();const value=JSON.parse(packed);
   const entries=value.files?.filter(f=>f.path===mapPath);if(entries?.length!==1)fail();
   const prepared=row.codec==='prepared-map'&&/^state\/self-development\/tracked-repair\/[a-f0-9]{64}\.prepared\.json$/.test(row.path),outbox=row.codec==='outbox-map'&&row.path==='receipt.json.request.json';if(!prepared&&!outbox)fail();
   const field=prepared?'content':'contentBase64';if(entries[0][field]!==mapMarker)fail();entries[0][field]=prepared?doc.toString('utf8'):doc.toString('base64');
   bytes=Buffer.from(JSON.stringify(value)+row.suffix);
  }
  if(hash(bytes)!==row.sha256)throw Error('TRACKED_ACTIONS_RECONSTRUCTED_HASH_MISMATCH');return {path:row.path,sha256:row.sha256,contentBase64:bytes.toString('base64')};
 });return {...cp,files:rows};
}
const brotli=raw=>brotliCompressSync(raw,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:5,[zlibConstants.BROTLI_PARAM_LGWIN]:22}});
export function encodeCheckpoint(cp){validateCheckpoint(cp);const raw=Buffer.from(JSON.stringify(cp));if(raw.length>2097152)throw Error('TRACKED_ACTIONS_DISPATCH_TOO_LARGE');let bytes=gzipSync(raw);
 if(bytes.toString('base64').length>60000)bytes=brotli(raw);
 if(bytes.toString('base64').length>60000){const packed=packFixedMap(cp);if(packed)bytes=brotli(Buffer.from(JSON.stringify(packed)));}
 const b64=bytes.toString('base64');if(b64.length>60000)throw Error('TRACKED_ACTIONS_DISPATCH_TOO_LARGE');return {b64,sha256:hash(bytes)};}
export function decodeCheckpoint(b64,sha256,options={}){if(typeof b64!=='string'||b64.length>60000||!hex(sha256))fail();const bytes=Buffer.from(b64,'base64');if(bytes.toString('base64')!==b64||hash(bytes)!==sha256)fail();
 let cp;try{cp=JSON.parse(bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes,{maxOutputLength:2097152}):brotliDecompressSync(bytes,{maxOutputLength:2097152}));if(cp?.kind==='tracked-repair-actions-fixed-map')cp=unpackFixedMap(cp,options);}catch{fail();}validateCheckpoint(cp);return cp;}
const envFor=pin=>({GORIQ_TRACKED_REPAIR_MANIFEST_FILE:FIXED_ROOT+'/manifest.json',GORIQ_TRACKED_REPAIR_MANIFEST_SHA256:pin});
async function currentIdentity(){const compass=new CompassStore(FIXED_ROOT+'/state/compass.sqlite');let goalId;try{const record=compass.getGoal();if(!record)fail();goalId=goalWorkStateId(compassGoalToLoopGoal(record));}finally{compass.close();}
 const jobs=await new JsonFileDevelopmentJobStore(FIXED_ROOT+'/state/self-development/jobs.json').getByGoal(goalId);if(jobs.length!==1)fail();
 const changes=await new JsonFileDevelopmentChangeSetStore(FIXED_ROOT+'/state/self-development/change-sets.json').list();const change=changes.find(c=>c.jobId===jobs[0].jobId&&c.workItemId.endsWith(':implement'));if(!change)fail();return {goalId,job:jobs[0],change};}
export async function createCheckpoint({phase='cloud',sourceRunId=null,head,output}={}){
 const manifest=bounded(FIXED_ROOT+'/manifest.json'),m=JSON.parse(manifest),manifestSha256=hash(manifest);readTrackedRepairManifest(envFor(manifestSha256));
 const identity=await currentIdentity();const names=['manifest.json','public.pem','frozen-probe.mjs','state/self-development/jobs.json','state/self-development/change-sets.json','receipt.json.request.json',
  ...m.trackedFiles.map(f=>'candidate/'+f.path),...(m.bookkeeping?['candidate/'+m.bookkeeping.path]:[]),'candidate/'+m.probe.targetPath];
 const journals=FIXED_ROOT+'/state/self-development/tracked-repair';for(const p of readdirSync(journals)){if(!/^[a-f0-9]{64}\.(?:prepared\.json(?:\.intent\.json|\.response\.json)?|red\.json(?:\.log)?)$/.test(p))fail();names.push('state/self-development/tracked-repair/'+p);}
 const db=new DatabaseSync(FIXED_ROOT+'/state/compass.sqlite',{readOnly:true}),snapshot=FIXED_ROOT+'/state/compass-export.sqlite';if(existsSync(snapshot))fail();
 try{await backup(db,snapshot);}finally{db.close();}
 let dbbytes;try{dbbytes=bounded(snapshot);}finally{unlinkSync(snapshot);}
 const rows=names.map(path=>({path,sha256:hash(bounded(FIXED_ROOT+'/'+path)),contentBase64:bounded(FIXED_ROOT+'/'+path).toString('base64')}));rows.push({path:'state/compass.sqlite',sha256:hash(dbbytes),contentBase64:dbbytes.toString('base64')});
 const cp={version:1,kind:'tracked-repair-actions-checkpoint',head:head??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),phase,sourceRunId,manifestSha256,
  goalId:identity.goalId,jobId:identity.job.jobId,changeSetId:identity.change.changeSetId,files:rows};validateCheckpoint(cp);if(output)writeFileSync(output,JSON.stringify(cp)+'\n',{flag:'wx',mode:0o600});return cp;
}
function writeNew(path,bytes){const absolute=assertExternalRuntimePath(join(FIXED_ROOT,path),[]);mkdirSync(dirname(absolute),{recursive:true,mode:0o700});writeFileSync(absolute,bytes,{flag:'wx',mode:0o600});}
function restoreCheckpoint(cp,repositoryRoot){const {manifest:m,files}=validateCheckpoint(cp);if(existsSync(FIXED_ROOT))throw Error('TRACKED_ACTIONS_ROOT_ALREADY_EXISTS');mkdirSync(FIXED_ROOT,{mode:0o700});
 const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,env:{PATH:process.env.PATH,HOME:process.env.HOME,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});
 const bare=FIXED_ROOT+'/repository.git',base=m.sequence.jobs[0].baseRevision;git(['init','--bare',bare]);git(['--git-dir='+bare,'fetch','--no-tags','--depth=1',repositoryRoot,base]);
 git(['--git-dir='+bare,'worktree','add','--detach',m.baselineWorkspace,base]);git(['--git-dir='+bare,'worktree','add','--detach',m.workspace,base]);
 for(const [path,bytes] of files){if(path.startsWith('candidate/')&&existsSync(FIXED_ROOT+'/'+path)){
   const file=assertExternalRuntimePath(FIXED_ROOT+'/'+path,[]),s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail();writeFileSync(file,bytes);
  }else writeNew(path,bytes);}
 readTrackedRepairManifest(envFor(cp.manifestSha256));
}
const intentSnapshot=()=>{const root=FIXED_ROOT+'/state/self-development/tracked-repair';return readdirSync(root).filter(p=>p.endsWith('.intent.json')).sort().map(p=>[p,hash(bounded(root+'/'+p))]);};
export async function runPhase({phase,checkpoint,receiptB64='',receiptSha256='',runId,repositoryRoot=resolve('.'),expectedHead,outputDirectory=resolve('.goriq-tracked-actions')}={}){
 if(!['A','B'].includes(phase)||!/^\d+$/.test(runId??''))fail();validateCheckpoint(checkpoint,{expectedHead,phase});
 if(phase==='B'&&checkpoint.sourceRunId===runId)throw Error('TRACKED_ACTIONS_DISTINCT_RUN_REQUIRED');
 restoreCheckpoint(checkpoint,repositoryRoot);const before=await currentIdentity(),intents=intentSnapshot();
 if(before.goalId!==checkpoint.goalId||before.job.jobId!==checkpoint.jobId||before.change.changeSetId!==checkpoint.changeSetId||before.job.phase!=='VERIFYING')fail();
 if(phase==='B'){if(!hex(receiptSha256)||typeof receiptB64!=='string'||receiptB64.length>32768)fail();const bytes=Buffer.from(receiptB64,'base64');if(bytes.toString('base64')!==receiptB64||hash(bytes)!==receiptSha256)fail();cleanBytes(bytes.toString('utf8'));JSON.parse(bytes);writeNew('receipt.json',bytes);}
 else if(receiptB64||receiptSha256)fail();
 const child=spawnSync(process.execPath,[join(repositoryRoot,'scripts/jarvis-goal-executor.ts')],{cwd:repositoryRoot,encoding:'utf8',timeout:60000,maxBuffer:131072,
  env:{PATH:process.env.PATH,HOME:process.env.HOME,...envFor(checkpoint.manifestSha256),JARVIS_GOAL_EXECUTION_GOAL_ID:checkpoint.goalId,JARVIS_GOAL_EXECUTION_COMPASS_PATH:FIXED_ROOT+'/state/compass.sqlite'}});
 if(child.status!==0||child.error)throw Error('TRACKED_ACTIONS_EXECUTOR_FAILED');
 const after=await currentIdentity();if(after.goalId!==checkpoint.goalId||after.job.jobId!==checkpoint.jobId||after.change.changeSetId!==checkpoint.changeSetId||after.job.phase!==(phase==='A'?'VERIFYING':'COMPLETED')
  ||JSON.stringify(intents)!==JSON.stringify(intentSnapshot()))throw Error('TRACKED_ACTIONS_RECOVERY_DID_NOT_MEET_CONTRACT');
 mkdirSync(outputDirectory,{recursive:true,mode:0o700});const cp=await createCheckpoint({phase,sourceRunId:phase==='A'?runId:checkpoint.sourceRunId,head:checkpoint.head,output:join(outputDirectory,'checkpoint.json')});
 const cacheKey='goriq-1219-tracked-v1-'+(phase==='A'?runId:checkpoint.sourceRunId)+'-'+checkpoint.manifestSha256.slice(0,16);
 const report={version:1,phase,runId,sourceRunId:cp.sourceRunId,head:cp.head,goalId:cp.goalId,jobId:cp.jobId,changeSetId:cp.changeSetId,jobPhase:after.job.phase,
  candidateRevision:after.change.candidateRevision,artifactDigest:after.change.artifactDigest,builderInvocations:0,manifestSha256:cp.manifestSha256,receiptSha256:phase==='B'?receiptSha256:null,cacheKey,next1218:'NOT_DEMONSTRATED',globalProduct:'NOT_ACHIEVED'};
 writeFileSync(join(outputDirectory,'report.json'),JSON.stringify(report)+'\n',{flag:'wx',mode:0o600});if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'cache_key='+cacheKey+'\n');return report;
}
async function cli(){const command=process.argv[2];if(command==='export'){const cp=await createCheckpoint({output:process.argv[3]});const packet=encodeCheckpoint(cp);writeFileSync(process.argv[3]+'.dispatch.json',JSON.stringify(packet)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({checkpointSha256:hash(JSON.stringify(cp)),dispatchBytes:packet.b64.length,manifestSha256:cp.manifestSha256,goalId:cp.goalId,jobId:cp.jobId}));return;}
 if(command!=='run'||process.env.GITHUB_ACTOR!=='haji84'||process.env.GITHUB_REPOSITORY!=='haji84/AI-')throw Error('TRACKED_ACTIONS_OWNER_ONLY');
 const phase=process.env.INPUT_PHASE;let cp;if(phase==='A')cp=decodeCheckpoint(process.env.INPUT_BOOTSTRAP_B64,process.env.INPUT_BOOTSTRAP_SHA256);else{const key=process.env.INPUT_CACHE_KEY;if(!/^goriq-1219-tracked-v1-\d+-[a-f0-9]{16}$/.test(key??''))fail();cp=JSON.parse(bounded(resolve('.goriq-tracked-actions-cache/checkpoint.json')));validateCheckpoint(cp,{phase:'B'});
  if(key!=='goriq-1219-tracked-v1-'+cp.sourceRunId+'-'+cp.manifestSha256.slice(0,16))fail();}
 const report=await runPhase({phase,checkpoint:cp,receiptB64:process.env.INPUT_RECEIPT_B64??'',receiptSha256:process.env.INPUT_RECEIPT_SHA256??'',runId:process.env.GITHUB_RUN_ID,expectedHead:process.env.GITHUB_SHA});
 if(phase==='A'){mkdirSync('.goriq-tracked-actions-cache',{recursive:true});writeFileSync('.goriq-tracked-actions-cache/checkpoint.json',bounded('.goriq-tracked-actions/checkpoint.json'),{flag:'wx',mode:0o600});}console.log(JSON.stringify(report));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await cli().catch(()=>{console.error('TRACKED_ACTIONS_FAILED_CLOSED');process.exitCode=1;});
