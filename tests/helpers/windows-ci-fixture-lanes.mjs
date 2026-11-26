// CI-only: two owned processes. Native fixture state remains process isolated.
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';

export async function runOwnedFixtureLanes(lanes,{cwd=process.cwd(),timeoutMs=90000,stdio='inherit',log=console.log}={}) {
 if(!Array.isArray(lanes)||lanes.length!==2||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>90000)throw Error('CI_FIXTURE_LANE_ARGUMENTS');
 const owned=[],tasks=[];let timeout=false,cancelled=false,stopping=false,stopTimer,stopGraceExpired=false;
 const cleanupErrors=[];let rejectUnclosed;
 const unclosed=new Promise((_,reject)=>{rejectUnclosed=reject;});
 const stop=()=>{
  if(stopping)return;stopping=true;
  for(const child of owned){
   if(!child.pid||child.exitCode!==null||child.signalCode!==null)continue;
   try{
    if(process.platform==='win32'){
     const result=spawnSync(join(process.env.SystemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});
     if(result.error||result.status!==0)cleanupErrors.push('CI_FIXTURE_TREE_STOP_UNVERIFIED');
    }else process.kill(-child.pid,'SIGKILL');
   }catch(error){if(error.code!=='ESRCH')cleanupErrors.push('CI_FIXTURE_TREE_STOP_UNVERIFIED');}
  }
  // A failed tree stop cannot make the close-event wait unbounded. Failure
  // stays visible; the hosted runner retains ownership of any leftovers.
  stopTimer=setTimeout(()=>{stopGraceExpired=true;for(const child of owned)child.unref();rejectUnclosed(Error('CI_FIXTURE_TREE_STOP_UNVERIFIED'));},5000);
 };
 const cancel=()=>{cancelled=true;stop();};
 process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
 const timer=setTimeout(()=>{timeout=true;stop();},timeoutMs);
 try{
  for(const lane of lanes)tasks.push(new Promise(resolve=>{
   log('CI_FIXTURE_LANE_START '+lane.name);
   let child;
   try{child=spawn(lane.command,lane.args,{cwd,stdio,windowsHide:true,detached:process.platform!=='win32'});owned.push(child);}
   catch{resolve({name:lane.name,code:null,error:true});return;}
   let error=false;child.once('error',()=>{error=true;});
   child.once('close',(code,signal)=>{try{log('CI_FIXTURE_LANE_END '+lane.name+' code='+code+' signal='+(signal??'NONE'));}catch{error=true;}resolve({name:lane.name,code,error});});
  }));
  const results=await Promise.race([Promise.all(tasks),unclosed]);
  if(timeout)throw Error('CI_FIXTURE_LANE_TIMEOUT'+(cleanupErrors.length?':CI_FIXTURE_TREE_STOP_UNVERIFIED':''));
  if(cancelled)throw Error('CI_FIXTURE_LANE_CANCELLED');
  if(results.some(row=>row.error||row.code!==0))throw Error('CI_FIXTURE_LANE_FAILED');
  return results;
 }finally{
  clearTimeout(timer);process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
  if(owned.some(child=>child.pid&&child.exitCode===null&&child.signalCode===null)){
   stop();let grace;
   if(!stopGraceExpired)await Promise.race([Promise.allSettled(tasks),new Promise(resolve=>{grace=setTimeout(resolve,5000);})]);
   clearTimeout(grace);for(const child of owned)child.unref();
  }
  clearTimeout(stopTimer);
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.platform!=='win32'||process.argv.length!==2)throw Error('CI_FIXTURE_WINDOWS_REQUIRED');
 const worker=join(process.cwd(),'tests','helpers','windows-ci-fixture-lane.ps1');
 const command=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 try{await runOwnedFixtureLanes(['atomic','media'].map(name=>({name,command,args:['-NoLogo','-NoProfile','-NonInteractive','-File',worker,'-Lane',name]})));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
