#!/usr/bin/env node
/**
 * Physical ZBook acceptance inventory, intentionally READ-ONLY.
 * Does not contact authenticated APIs, print tokens, write files, launch
 * a Goal, start/stop any service or modify either existing Worktree.
 */
import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root=resolve(process.cwd());
const git=(...args)=>execFileSync("git",["--no-optional-locks",...args],{
  cwd:root,encoding:"utf8",windowsHide:true,timeout:9000}).trim();
const inspect=(command,args)=>execFileSync(command,args,{
  cwd:root,encoding:"utf8",windowsHide:true,timeout:4000,maxBuffer:32768}).trim();
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
export function pinnedVerifierImage(value) {
  return typeof value==="string"
    && /^[a-z0-9][a-z0-9._/:@-]*@sha256:[0-9a-f]{64}$/.test(value);
}
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
    verifier:{dockerCliAvailable:false,dockerDaemonReachable:false,pinnedImageConfigured:false,
      pinnedImagePresent:false,publicKeyFingerprintMatched:false,independentOSPrincipalVerified:false},
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
  const image=process.env.GORIQ_VERIFIER_CONTAINER_IMAGE||"";
  response.verifier.pinnedImageConfigured=pinnedVerifierImage(image);
  try {
    inspect("docker",["--version"]);
    response.verifier.dockerCliAvailable=true;
    inspect("docker",["info","--format","{{.ServerVersion}}"]);
    response.verifier.dockerDaemonReachable=true;
    if(response.verifier.pinnedImageConfigured) {
      // Image inspection is read-only and never pulls or starts containers.
      const digests=JSON.parse(inspect("docker",["image","inspect",image,"--format","{{json .RepoDigests}}"]));
      response.verifier.pinnedImagePresent=Array.isArray(digests)&&digests.includes(image);
    }
  }catch{response.reasons.push("VERIFIER_CONTAINER_PREREQUISITE_NOT_CONFIRMED");}
  if(!response.verifier.pinnedImageConfigured)response.reasons.push("VERIFIER_IMAGE_NOT_DIGEST_PINNED");
  if(!response.verifier.pinnedImagePresent)response.reasons.push("PINNED_VERIFIER_IMAGE_NOT_AVAILABLE_OFFLINE");
  const keyPath=process.env.GORIQ_LOCAL_VERIFIER_PUBLIC_KEY_FILE||"";
  const expectedFingerprint=process.env.GORIQ_LOCAL_VERIFIER_PUBLIC_KEY_SHA256||"";
  if(isAbsolute(keyPath)&&/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
    try {
      const st=lstatSync(keyPath);
      if(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=8192&&existsSync(keyPath)) {
        response.verifier.publicKeyFingerprintMatched=
          sha256(readFileSync(keyPath))===expectedFingerprint;
      }
    }catch{/* Missing/denied public key stays unverified. */}
  }
  if(!response.verifier.publicKeyFingerprintMatched)response.reasons.push("VERIFIER_PUBLIC_KEY_NOT_PINNED");
  // A process flag or a reachable TCP listener does not establish signed
  // execution identity, authorization, or E2E Goal continuation.
  response.reasons.push("SEPARATE_VERIFIER_PRINCIPAL_NOT_ATTESTED");
  response.reasons.push("PHYSICAL_GOAL_RESTART_AND_NEXT_JOB_UNPROVEN");
  process.stdout.write(JSON.stringify(response)+"\n");
}
await main();
