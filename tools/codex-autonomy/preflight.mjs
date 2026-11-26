import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function recommend(input) {
  const {cpuCount,availableMemoryGiB,totalMemoryGiB,independentTasks=2,quotaRemainingPercent=null,sessionCap=3,projectMaxActiveAgents=null,loadPerCpu=null}=input;
  for(const [key,value] of Object.entries({cpuCount,availableMemoryGiB,totalMemoryGiB,independentTasks,sessionCap})) {
    if(!Number.isFinite(value)||value<0||(['cpuCount','sessionCap'].includes(key)&&value<1)) throw new Error(`Invalid metric: ${key}`);
  }
  if(quotaRemainingPercent!==null&&(!Number.isFinite(quotaRemainingPercent)||quotaRemainingPercent<0||quotaRemainingPercent>100)) throw new Error('Invalid quota');
  if(projectMaxActiveAgents!==null&&(!Number.isInteger(projectMaxActiveAgents)||projectMaxActiveAgents<1)) throw new Error('Invalid project cap');
  if(loadPerCpu!==null&&(!Number.isFinite(loadPerCpu)||loadPerCpu<0)) throw new Error('Invalid load');
  const memoryCap=Math.max(0,Math.floor((availableMemoryGiB-2)/2));
  const cpuCap=Math.max(1,Math.floor(cpuCount/4));
  const quotaCap=quotaRemainingPercent===0?0:quotaRemainingPercent===null?2:quotaRemainingPercent<=10?1:sessionCap;
  const loadCap=loadPerCpu!==null&&loadPerCpu>=0.85?1:sessionCap;
  const projectCap=projectMaxActiveAgents===null?sessionCap:Math.max(0,projectMaxActiveAgents-1);
  return {recommendedChildren:Math.max(0,Math.floor(Math.min(memoryCap,cpuCap,quotaCap,loadCap,projectCap,sessionCap,independentTasks))),caps:{memory:memoryCap,cpu:cpuCap,quota:quotaCap,load:loadCap,project:projectCap,session:sessionCap},metrics:input,notes:['Advisory admission; recheck after material load/quota changes.','Native child-thread cap excludes the primary.','Use the existing heavy-execution lane when the project provides one.','Unknown quota limits admission to two children; never buy credits or enable API fallback.']};
}
export function hostMetrics(cwd=process.cwd()) {
  const cpuCount=os.availableParallelism();
  let loadPerCpu=process.platform==='win32'?null:os.loadavg()[0]/cpuCount;
  if(process.platform==='win32') {
    const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime"],{encoding:'utf8',windowsHide:true,timeout:4000});
    const p=Number(r.stdout?.trim()); if(r.status===0&&Number.isFinite(p)&&p>=0&&p<=100) loadPerCpu=p/100;
  }
  let projectMaxActiveAgents=null;
  const git=spawnSync('git',['-C',cwd,'rev-parse','--show-toplevel'],{encoding:'utf8',timeout:2000,windowsHide:true});
  const root=git.status===0?git.stdout.trim():cwd;
  for(const name of ['AGENTS.md','PROJECT_STATE.md']) {
    const file=path.join(root,name);
    if(fs.existsSync(file)&&fs.statSync(file).size<131072) {
      const values=[...fs.readFileSync(file,'utf8').matchAll(/MAX_ACTIVE_AGENTS\s*[:=]\s*(\d+)/g)].map(m=>Number(m[1]));
      for(const n of values) if(n>0) projectMaxActiveAgents=projectMaxActiveAgents===null?n:Math.min(projectMaxActiveAgents,n);
    }
  }
  const totalMemoryGiB=os.totalmem()/2**30;
  const sessionCap=Math.max(1,Math.min(6,Math.floor(totalMemoryGiB/8),Math.floor(cpuCount/4)));
  return {cpuCount,totalMemoryGiB,availableMemoryGiB:os.freemem()/2**30,loadPerCpu,projectMaxActiveAgents,independentTasks:2,quotaRemainingPercent:null,sessionCap};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2); const value=flag=>args[args.indexOf(flag)+1];
    const metrics=args.includes('--input')?JSON.parse(value('--input')):hostMetrics(args.includes('--cwd')?value('--cwd'):process.cwd());
    if(args.includes('--tasks')) metrics.independentTasks=Number(value('--tasks'));
    if(args.includes('--quota')) metrics.quotaRemainingPercent=Number(value('--quota'));
    if(args.includes('--session-cap')) metrics.sessionCap=Number(value('--session-cap'));
    process.stdout.write(JSON.stringify(recommend(metrics))+'\n');
  } catch(e) {process.stderr.write(e.message+'\n');process.exitCode=1;}
}
