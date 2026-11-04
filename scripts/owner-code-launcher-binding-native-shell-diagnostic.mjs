// Temporary PUBLIC-fixture diagnosis only. This is not source acceptance.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,openSync,readFileSync,readSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const diagnosticStarted=Date.now(),overallDeadline=diagnosticStarted+90000;
const executable='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const taskkill='C:\\Windows\\System32\\taskkill.exe';
const flags='-NoLogo -NoProfile -NonInteractive';
const workflowPath='.github/workflows/gai-zbook-diagnostic-1218.yml';
const workerPath='scripts/owner-code-launcher-binding-inspection-1218.ps1';
const frozenPath='scripts/owner-code-launcher-binding-native-shell.test.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const pins={
 [workflowPath]:'0a38327ec1d812ff5e0fc86137bd7228a5db9ab610169fefbb1a9d588ceded4a',
 [workerPath]:'e3eceed0868c6f3e84a1fa53cbe919e15fcae4686966ef715af29a9b96b516f6',
 [frozenPath]:'b39caba3b3349c7531702dd6e3bcbed207699561828a0b1ab2345f952b08b4a9',
};
for(const [path,hash] of Object.entries(pins))assert.equal(digest(readFileSync(path)),hash,path);
const diagnosticBytes=readFileSync(fileURLToPath(import.meta.url));
const diagnosticHashes={rawSha256:digest(diagnosticBytes),lfNormalizedSha256:digest(diagnosticBytes.toString('utf8').replaceAll('\r\n','\n'))};
process.stdout.write(JSON.stringify({label:'PUBLIC_DIAGNOSTIC_V3_ONLY_NOT_ACCEPTANCE',event:'diagnostic-source',diagnosticHashes,overallBudgetMs:90000})+'\n');
const entry=readFileSync(workflowPath,'utf8').split(/^ {6}- /m).find(step=>step.startsWith('name: Inspect separately approved fixed launcher bindings as data only\n'));
const shell=entry?.match(/^ {8}shell: (.+)$/m)?.[1];
const expectedShell=`${executable} ${flags} -Command "& ([scriptblock]::Create([System.IO.File]::ReadAllText('{0}')))"`;
assert.equal(shell,expectedShell);
const body=entry.match(/^ {8}run: \|\n((?: {10}.*\n)+)/m)[1].split('\n').map(line=>line.slice(10)).join('\n');
assert.equal(body,"$ErrorActionPreference = 'Stop'\nNew-Item -ItemType Directory -Force -Path .gai-results | Out-Null\n"+`& '${executable}' ${flags} -File .\\scripts\\owner-code-launcher-binding-inspection-1218.ps1 -Inspect | Tee-Object -FilePath .gai-results/owner-code-launcher-bindings-1218.json\n`+'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const essentials=['SystemDrive','PATH','PATHEXT','ComSpec','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)','ProgramData','PSModulePath'];
const expected={schemaVersion:1,issue:1218,operation:'launcher-binding-inspection',complete:false,failureCode:'LBI_GRANT_REQUIRED',sourceRevision:null,workflowRunId:null,workflowRunAttempt:null,sourceHashesVerified:false,publicCiVerified:false,actualWindowsOwnerContextVerified:false,taskBindingVerified:false,claimConsumed:false,exactlyTwoTargets:false,compatibilityStructure:'UNKNOWN',nativeStructure:'UNKNOWN',fixedDelegationMatched:false,nativeRelationCandidate:false,protectedLocalRecordWritten:false,noExecution:true,authorizationGranted:false,readyForRotation:false,actualAcceptanceConditionsPassed:0};
function environment(root,profile){
 const result={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR??process.env.SystemRoot,TEMP:root,TMP:root,PATHEXT:'.EXE',GORIQ_OWNER_LAUNCHER_BINDING_GRANT_BASE64:''};
 if(profile==='public-essentials')for(const name of essentials)if(process.env[name]!==undefined)result[name]=process.env[name];
 return result;
}
function publicFile(path){
 if(!existsSync(path))return {exists:false};
 let handle;
 try{
  const size=statSync(path).size;handle=openSync(path,'r');const buffer=Buffer.alloc(Math.min(size,16384)),length=readSync(handle,buffer,0,buffer.length,0),bytes=buffer.subarray(0,length);
  return {exists:true,bytes:size,truncated:size>16384,text:bytes[0]===255&&bytes[1]===254?bytes.subarray(2).toString('utf16le'):bytes.toString('utf8').replace(/^\uFEFF/,'')};
 }catch(error){return {exists:true,readErrorCode:error.code??'UNKNOWN'};}
 finally{if(handle!==undefined)closeSync(handle);}
}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'goriq public shell diagnosis 1218-'));mkdirSync(join(root,'scripts'));
 const worker=join(root,'scripts','owner-code-launcher-binding-inspection-1218.ps1');copyFileSync(resolve(workerPath),worker);assert.equal(digest(readFileSync(worker)),pins[workerPath]);
 const markerPath=join(root,'public-stages.txt'),artifact=join(root,'.gai-results','owner-code-launcher-bindings-1218.json');
 const mark=label=>`[System.IO.File]::AppendAllText(${quote(markerPath)},${quote(label+'\n')})`;
 const instrumented=[mark('wrapper-enter'),"$ErrorActionPreference = 'Stop'",mark('before-module-path-clamp'),"$env:PSModulePath = [System.IO.Path]::Combine($PSHOME,'Modules')",mark('after-module-path-clamp'),...body.trimEnd().split('\n').flatMap((line,index)=>[mark('before-original-line-'+index),line,mark('after-original-line-'+index)]),mark('wrapper-end')].join('\n')+'\n';
 const wrapper=join(root,'actions-generated-public-body');writeFileSync(wrapper,instrumented);
 const rawArguments=shell.slice(executable.length+1).replace('{0}',wrapper);
 return {root,rawArguments,markerPath,artifact};
}
async function probe(profile){
 const kind='combined-module-clamp-and-executable-extension';
 const {root,rawArguments,markerPath,artifact}=fixture(),env=environment(root,profile),started=Date.now();
 const probeDeadline=Math.min(started+10000,overallDeadline),workBudgetMs=Math.min(8000,Math.max(0,probeDeadline-started-2000));
 const record={label:'PUBLIC_DIAGNOSTIC_V3_ONLY_NOT_ACCEPTANCE',kind,profile,environmentKeyNames:Object.keys(env).sort(),emptyGrant:true,budgetMs:workBudgetMs,totalBudgetWithCleanupMs:probeDeadline-started,stdinMode:'async-pipe-ended-not-identical-to-frozen-spawnSync',events:[],timedOut:false,code:null,signal:null,closeCode:null,closeSignal:null,cleanup:null};
 process.stdout.write(JSON.stringify({label:record.label,kind,profile,event:'start'})+'\n');
 let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),stdoutTruncated=false,stderrTruncated=false;
 const append=(current,bytes)=>Buffer.concat([current,bytes]).subarray(0,65536);
 await new Promise(resolveProbe=>{
  const child=spawn(executable,[rawArguments],{cwd:root,env,windowsVerbatimArguments:true,shell:false,stdio:['pipe','pipe','pipe']});
  let finished=false,exitObserved=false,closeObserved=false;
  const event=(type,details={})=>{if(record.events.length<64)record.events.push({ms:Date.now()-started,type,...details});};
  const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(cleanupTimer);record.exitObserved=exitObserved;record.closeObserved=closeObserved;resolveProbe();};
  child.stdout.on('data',bytes=>{stdoutTruncated||=stdout.length+bytes.length>65536;stdout=append(stdout,bytes);event('stdout',{bytes:bytes.length});});
  child.stderr.on('data',bytes=>{stderrTruncated||=stderr.length+bytes.length>65536;stderr=append(stderr,bytes);event('stderr',{bytes:bytes.length});});
  child.once('spawn',()=>event('spawn',{ownPid:child.pid}));
  child.once('error',error=>{event('spawn-error',{code:error.code??null,message:error.message});});
  child.once('exit',(code,signal)=>{exitObserved=true;record.code=code;record.signal=signal;event('exit',{code,signal});});
  child.once('close',(code,signal)=>{closeObserved=true;record.closeCode=code;record.closeSignal=signal;event('close',{code,signal});finish();});
  child.stdin.on('error',error=>event('stdin-error',{code:error.code??null}));
  child.stdin.end();event('stdin-ended');
  let cleanupTimer;
  const timer=setTimeout(()=>{
   record.timedOut=true;event('budget-expired');
   if(!exitObserved&&child.exitCode===null&&child.signalCode===null&&Number.isInteger(child.pid)&&child.pid>0&&child.pid!==process.pid){
    const cleanup=spawnSync(taskkill,['/PID',String(child.pid),'/T','/F'],{encoding:'utf8',timeout:2000,windowsHide:true,env:environment(root,'minimal-pathext')});
    record.cleanup={action:'fixed-taskkill-own-unexited-child-tree',ownPid:child.pid,status:cleanup.status,signal:cleanup.signal,errorCode:cleanup.error?.code??null};
   }else record.cleanup={action:'owned-pipes-only',reason:exitObserved?'parent-exited-inherited-stream-close-uncertain':'no-live-owned-child-pid'};
   child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
   cleanupTimer=setTimeout(()=>{event('cleanup-deadline');child.unref();finish();},Math.max(0,probeDeadline-Date.now()));
  },workBudgetMs);
 });
 record.elapsedMs=Date.now()-started;record.stdout=stdout.toString('utf8');record.stderr=stderr.toString('utf8');record.stdoutTruncated=stdoutTruncated;record.stderrTruncated=stderrTruncated;
 record.artifact=publicFile(artifact);record.stageBreadcrumbs=publicFile(markerPath);record.fixtureEntryNames=readdirSync(root).sort();record.fixtureRetainedForRunnerCleanup=true;
 const closed=value=>{try{return isDeepStrictEqual(JSON.parse(value),expected);}catch{return false;}};
 record.combinedProof={exitOne:record.code===1,stderrEmpty:record.stderr==='',stdoutClosedEmptyGrant:closed(record.stdout.trim()),artifactClosedEmptyGrant:closed(record.artifact.text??''),noTimeout:!record.timedOut};
 record.combinedProof.allMatched=Object.values(record.combinedProof).every(value=>value===true);
 process.stdout.write(JSON.stringify(record)+'\n');
 return record;
}

if(process.platform!=='win32')process.stdout.write(JSON.stringify({label:'PUBLIC_DIAGNOSTIC_V3_ONLY_NOT_ACCEPTANCE',result:'SKIPPED_REQUIRES_ACTUAL_WINDOWS_POWERSHELL_5',sourcePins:pins})+'\n');
else{
 const results=[];
 for(const profile of ['minimal-pathext','public-essentials']){
  if(overallDeadline-Date.now()<10000){process.stdout.write(JSON.stringify({label:'PUBLIC_DIAGNOSTIC_V3_ONLY_NOT_ACCEPTANCE',event:'overall-budget-stopped-before-next-probe',completedStages:results.length})+'\n');break;}
  results.push(await probe(profile));
 }
 process.stdout.write(JSON.stringify({label:'PUBLIC_DIAGNOSTIC_V3_ONLY_NOT_ACCEPTANCE',stages:results.length,timedOut:results.filter(result=>result.timedOut).length,combinedProofMatches:results.filter(result=>result.combinedProof.allMatched).length,elapsedMs:Date.now()-diagnosticStarted,overallBudgetMs:90000,diagnosticHashes,sourcePins:pins})+'\n');
}
