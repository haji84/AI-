import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ResidentDevelopmentGoalHost } from "./resident-development-goal-host.ts";
import { residentDevelopmentSequenceJobId, validateResidentDevelopmentSequence, type ResidentDevelopmentSequence } from "./resident-development-sequence.ts";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "./resident-runtime-files.ts";
import { assertTrackedRepairProfileExclusive, createTrackedRepairRuntimeOptions, readTrackedRepairManifest, type TrackedRepairRuntimeInput } from "./tracked-repair-resident-runtime.ts";
import type { Goal } from "./goal-loop.ts";

interface RepairBinding {key:string;manifestFile:string;manifestSha256:string;}
export interface TrackedRepairSequenceManifest {version:1;profile:"tracked-source-sequence-v1";sequence:ResidentDevelopmentSequence;repairs:RepairBinding[];}
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const digest=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
// Future receipt files use their existing parent's identity too (including Windows aliases).
const canonical=(p:string)=>{
  let ancestor=resolve(p);const missing:string[]=[];
  while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)break;missing.unshift(basename(ancestor));ancestor=parent;}
  const path=resolve(realpathSync.native(ancestor),...missing);
  return process.platform==="win32"?path.toLowerCase():path;
};
const contains=(a:string,b:string)=>{const r=relative(canonical(a),canonical(b));return !r||(!isAbsolute(r)&&r!==".."&&!r.startsWith(".."+sep));};
const external=(file:string,workspaces:string[])=>{
  assertExternalRuntimePath(file,workspaces);
  if(workspaces.some(workspace=>contains(workspace,file)))throw Error("TRACKED_SEQUENCE_AUTHORITY_OVERLAP");
};
const exact=(v:unknown,keys:string):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join(",")===keys;

/** A pinned host composition, not an intake/model-supplied execution plan. */
export function readTrackedRepairSequence(env:Record<string,string|undefined>,goal?:Goal){
  const file=env.GORIQ_TRACKED_REPAIR_SEQUENCE_FILE?.trim(),pin=env.GORIQ_TRACKED_REPAIR_SEQUENCE_SHA256?.trim();
  if(!file&&!pin)return null;
  assertTrackedRepairProfileExclusive(env);
  if(!file||!isAbsolute(file)||!digest(pin))throw Error("TRACKED_SEQUENCE_PIN_REQUIRED");
  const bytes=readBoundedRuntimeFile(file,131072);
  if(hash(bytes)!==pin)throw Error("TRACKED_SEQUENCE_PIN_MISMATCH");
  const raw:unknown=JSON.parse(bytes.toString("utf8"));
  if(!exact(raw,"profile,repairs,sequence,version")||raw.version!==1||raw.profile!=="tracked-source-sequence-v1")throw Error("TRACKED_SEQUENCE_MANIFEST_INVALID");
  const manifest=raw as unknown as TrackedRepairSequenceManifest,s=manifest.sequence;
  if(!s||s.version!==1||!digest(s.goalDigest)||s.maxRisk!=="low"||s.completionMode!=="verified-local-artifact"
    ||!Array.isArray(s.jobs)||!s.jobs.length||s.jobs.length>32||!Array.isArray(manifest.repairs)||manifest.repairs.length!==s.jobs.length
    ||!Number.isFinite(Date.parse(s.expiresAt))||Date.parse(s.expiresAt)<=Date.now())throw Error("TRACKED_SEQUENCE_SCOPE_INVALID");
  if(goal)validateResidentDevelopmentSequence(s,goal,{taskScopeId:s.taskScopeId,maxRisk:"low"});
  const keys=new Set<string>();
  const repairs=manifest.repairs.map((binding,index)=>{
    if(!exact(binding,"key,manifestFile,manifestSha256")||typeof binding.key!=="string"||keys.has(binding.key)
      ||binding.key!==s.jobs[index]?.key||typeof binding.manifestFile!=="string"||!isAbsolute(binding.manifestFile)||!digest(binding.manifestSha256))throw Error("TRACKED_SEQUENCE_BINDING_INVALID");
    keys.add(binding.key);
    const leafEnv={GORIQ_TRACKED_REPAIR_MANIFEST_FILE:binding.manifestFile,GORIQ_TRACKED_REPAIR_MANIFEST_SHA256:binding.manifestSha256};
    const leaf=readTrackedRepairManifest(leafEnv);
    if(!leaf||!isDeepStrictEqual(leaf.manifest.sequence,{...s,jobs:[s.jobs[index]!]}))throw Error("TRACKED_SEQUENCE_LEAF_BINDING_INVALID");
    return {binding,env:leafEnv,manifest:leaf.manifest};
  });
  const workspaces=repairs.flatMap(r=>[r.manifest.workspace,r.manifest.baselineWorkspace,...(r.manifest.recoveryAttempts??[]).map(a=>a.workspace)]);
  for(const [index,workspace] of workspaces.entries())if(workspaces.slice(0,index).some(other=>contains(workspace,other)||contains(other,workspace)))throw Error("TRACKED_SEQUENCE_WORKSPACE_OVERLAP");
  const receipts=repairs.flatMap(r=>[r.manifest.verifier.receiptFile,...(r.manifest.recoveryAttempts??[]).map(a=>a.receiptFile)]);
  const writers=receipts.flatMap(p=>[p,p+".request.json"]),readers=[file,...repairs.flatMap(r=>[r.binding.manifestFile,r.manifest.probe.file,r.manifest.verifier.publicKeyFile])];
  if(new Set(writers.map(canonical)).size!==writers.length||writers.some(p=>readers.some(other=>canonical(p)===canonical(other))))throw Error("TRACKED_SEQUENCE_AUTHORITY_OVERLAP");
  for(const authority of [...writers,...readers])external(authority,workspaces);
  return {manifest,pin,repairs,workspaces,receipts};
}

/** One existing Resident controller selects Jobs; only its concrete stages are delegated. */
export function createTrackedRepairSequenceRuntime(input:TrackedRepairRuntimeInput):ResidentDevelopmentGoalHost|null {
  const loaded=readTrackedRepairSequence(input.env,input.goal);if(!loaded)return null;
  external(input.compassPath,loaded.workspaces);
  external(join(dirname(input.compassPath),"self-development"),loaded.workspaces);
  external(join(dirname(input.compassPath),"self-development","tracked-repair"),loaded.workspaces);
  if(loaded.workspaces.some(workspace=>contains(workspace,input.runtimeRoot)||contains(input.runtimeRoot,workspace)))throw Error("TRACKED_SEQUENCE_RUNTIME_OVERLAP");
  let persistence=input.persistence;
  const configurations=loaded.repairs.map(r=>{
    const options=createTrackedRepairRuntimeOptions({...input,env:r.env,persistence},
      {sequence:loaded.manifest.sequence,key:r.binding.key,executionContractDigest:loaded.pin})!;
    persistence??={jobs:options.jobs,changeSets:options.changeSets};
    return {key:r.binding.key,options};
  });
  const sequence={...loaded.manifest.sequence,executionContractDigest:loaded.pin};
  const forJob=(job:{goalId:string;jobId:string})=>{
    const selected=configurations.find(c=>residentDevelopmentSequenceJobId(job.goalId,sequence,c.key)===job.jobId);
    if(!selected)throw Error("TRACKED_SEQUENCE_JOB_UNKNOWN");return selected.options.stages;
  };
  const first=configurations[0]!.options;
  return new ResidentDevelopmentGoalHost({...first,planning:{...first.planning,sequence,
    targetFiles:[...new Set(sequence.jobs.flatMap(j=>j.targetFiles))]},stages:{builderId:first.stages.builderId,deferMissingVerification:true,
    build:input=>forJob(input.job).build(input),
    verifyRed:input=>forJob(input.job).verifyRed!(input),
    verify:input=>forJob(input.job).verify(input),
    acceptanceEvidence:input=>forJob(input.job).acceptanceEvidence!(input),
    releaseState:input=>forJob(input.job).releaseState(input),
  }});
}
