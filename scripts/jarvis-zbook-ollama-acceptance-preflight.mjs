#!/usr/bin/env node
/**
 * Physical ZBook acceptance inventory, intentionally READ-ONLY.
 * Does not contact authenticated APIs, print tokens, write files, launch
 * a Goal, start/stop any service or modify either existing Worktree.
 */
import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { resolve } from "node:path";

const root=resolve(process.cwd());
const git=(...args)=>execFileSync("git",["--no-optional-locks",...args],{
  cwd:root,encoding:"utf8",windowsHide:true,timeout:9000}).trim();
const listen=port=>new Promise(done=>{
  const sock=connect({host:"127.0.0.1",port});
  const settle=value=>{sock.destroy();done(value);};
  sock.setTimeout(1200);
  sock.once("connect",()=>settle(true));
  sock.once("error",()=>settle(false));
  sock.once("timeout",()=>settle(false));
});
async function main(){
  const response={kind:"read-only-zbook-preflight",platform:process.platform,
    codeRevision:null,modifiedTracked:null,untracked:null,
    worktreeCount:null,originalEvidenceWorktreeRegistered:false,
    ports:[],ollama:{model:process.env.GAI_LOCAL_MODEL_NAME||"qwen2.5-coder:3b",installed:false},
    independentVerifierOSPrincipalVerified:false,
    authenticBrokerGoalE2ECompleted:false,reasons:[]};
  try{
    response.codeRevision=git("rev-parse","HEAD");
    const changes=git("status","--porcelain","-uall").split("\n").filter(Boolean);
    response.modifiedTracked=changes.filter(x=>!x.startsWith("?? ")).length;
    response.untracked=changes.filter(x=>x.startsWith("?? ")).length;
    const worktrees=git("worktree","list","--porcelain").split("\n");
    response.worktreeCount=worktrees.filter(x=>x.startsWith("worktree ")).length;
    response.originalEvidenceWorktreeRegistered=worktrees.some(x=>x.includes("goal-1-0cab380c62fb4766ab34cff9974807a1"));
  }catch{response.reasons.push("LOCAL_GIT_INVENTORY_UNAVAILABLE");}
  for(const port of [8787,8796,8797]){
    const reachable=await listen(port);
    response.ports.push({port,loopbackListener:reachable});
    if(!reachable)response.reasons.push("EXISTING_LISTENER_MISSING:"+port);
  }
  try{
    const res=await fetch("http://127.0.0.1:11434/api/tags",{signal:AbortSignal.timeout(2500)});
    const data=await res.json();
    response.ollama.installed=Array.isArray(data.models)&&data.models.some(m=>m.name===response.ollama.model||m.model===response.ollama.model);
  }catch{response.reasons.push("LOCAL_OLLAMA_UNREACHABLE");}
  if(!response.ollama.installed)response.reasons.push("PINNED_MODEL_NOT_CONFIRMED");
  // A process flag or a reachable TCP listener does not establish signed
  // execution identity, authorization, or E2E Goal continuation.
  response.reasons.push("SEPARATE_VERIFIER_PRINCIPAL_NOT_ATTESTED");
  response.reasons.push("PHYSICAL_GOAL_RESTART_AND_NEXT_JOB_UNPROVEN");
  process.stdout.write(JSON.stringify(response)+"\n");
}
await main();
