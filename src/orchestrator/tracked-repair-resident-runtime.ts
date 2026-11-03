import { createHash, createPublicKey } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Goal } from "./goal-loop.ts";
import { createDevelopmentChangeSet } from "./development-change-set.ts";
import { JsonFileDevelopmentJobStore } from "./development-job-store.ts";
import { JsonFileDevelopmentChangeSetStore } from "./development-change-set-store.ts";
import { ResidentDevelopmentGoalHost } from "./resident-development-goal-host.ts";
import { validateResidentDevelopmentSequence, type ResidentDevelopmentSequence } from "./resident-development-sequence.ts";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "./resident-runtime-files.ts";
import { validateSignedLocalVerifierReceipt } from "./signed-local-verifier-receipt.ts";
import { withDevelopmentResourceAdmission } from "../gai/development-resource-admission.ts";

const hash=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
const digest=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const path=(v:unknown):v is string=>typeof v==="string"&&/^(src|scripts)\/[A-Za-z0-9_./-]+$/.test(v)&&!v.split("/").some(p=>!p||p==="."||p==="..");
const exact=(v:unknown,keys:string):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join(",")===keys;
const contains=(parent:string,child:string)=>{const rel=relative(parent,child);return !rel||(!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep));};
const builderId="local-tracked-model-builder";
const checks=["lint","typecheck","unit","integration","security","build"];
interface FilePin {path:string;beforeSha256:string}
interface Slot {id:number;path:string;before:string}
export interface TrackedRepairManifest {
  version:1;profile:"tracked-source-repair-v1";sequence:ResidentDevelopmentSequence;
  workspace:string;baselineWorkspace:string;targetPath:string;trackedFiles:FilePin[];slots:Slot[];
  probe:{file:string;sha256:string;targetPath:string;expectedRedText:string};
  model:{endpoint:string;id:string;sha256:string;nPredict:number;timeoutMs:number};
  verifier:{publicKeyFile:string;publicKeySha256:string;receiptFile:string};
}
interface Attestation {candidateRevision:string;artifactDigest:string;patchDigest:string;fileHashes:Record<string,string>}
async function modelBody(reply:Response):Promise<string>{
  if(!reply.ok||!reply.body)throw Error("TRACKED_REPAIR_MODEL_HTTP_FAILED");
  const reader=reply.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;
    if(size>131072)throw Error("TRACKED_REPAIR_MODEL_OUTPUT_TOO_LARGE");chunks.push(item.value);}}
  finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  return Buffer.concat(chunks).toString("utf8");
}

/** Pins are host configuration, never owner prose/model output. This profile
 * only produces a LOW isolated artifact; it cannot publish or rotate secrets. */
export function readTrackedRepairManifest(env:Record<string,string|undefined>,goal?:Goal):{manifest:TrackedRepairManifest;pin:string}|null {
  const file=env.GORIQ_TRACKED_REPAIR_MANIFEST_FILE?.trim(),pin=env.GORIQ_TRACKED_REPAIR_MANIFEST_SHA256?.trim();
  if(!file&&!pin)return null;
  if(!file||!isAbsolute(file)||!digest(pin))throw Error("TRACKED_REPAIR_MANIFEST_PIN_REQUIRED");
  if(env.GORIQ_COMPLETION_HANDOFF_PATH||env.GORIQ_COMPLETION_HANDOFF_SHA256||env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE||env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256)
    throw Error("TRACKED_REPAIR_MULTIPLE_RUNTIME_PROFILES");
  const bytes=readBoundedRuntimeFile(file,131072);
  if(hash(bytes)!==pin)throw Error("TRACKED_REPAIR_MANIFEST_PIN_MISMATCH");
  const value:unknown=JSON.parse(bytes.toString("utf8"));
  if(!exact(value,"baselineWorkspace,model,probe,profile,sequence,slots,targetPath,trackedFiles,verifier,version,workspace")
    ||value.version!==1||value.profile!=="tracked-source-repair-v1")throw Error("TRACKED_REPAIR_MANIFEST_INVALID");
  const m=value as unknown as TrackedRepairManifest;
  if(!m.sequence||m.sequence.jobs?.length!==1||m.sequence.completionMode!=="verified-local-artifact"||m.sequence.maxRisk!=="low"
    ||!Number.isFinite(Date.parse(m.sequence.expiresAt))||Date.parse(m.sequence.expiresAt)<=Date.now()
    ||!isAbsolute(m.workspace??"")||!isAbsolute(m.baselineWorkspace??"")||contains(m.workspace,m.baselineWorkspace)||contains(m.baselineWorkspace,m.workspace)
    ||!path(m.targetPath)||!Array.isArray(m.trackedFiles)||!m.trackedFiles.length||m.trackedFiles.length>8
    ||m.trackedFiles.some(f=>!exact(f,"beforeSha256,path")||!path(f.path)||!digest(f.beforeSha256))
    ||new Set(m.trackedFiles.map(f=>f.path)).size!==m.trackedFiles.length||!m.trackedFiles.some(f=>f.path===m.targetPath)
    ||!Array.isArray(m.slots)||!m.slots.length||m.slots.length>8||m.slots.some(s=>!exact(s,"before,id,path")||!Number.isInteger(s.id)||s.id<1||s.id>32
      ||!m.trackedFiles.some(f=>f.path===s.path)||typeof s.before!=="string"||!s.before.length||s.before.length>12000)
    ||new Set(m.slots.map(s=>s.id)).size!==m.slots.length)throw Error("TRACKED_REPAIR_SCOPE_INVALID");
  if(!exact(m.probe,"expectedRedText,file,sha256,targetPath")||!isAbsolute(m.probe.file??"")||!digest(m.probe.sha256)
    ||!/^tests\/[A-Za-z0-9_/-]+\.test\.(mjs|ts)$/.test(m.probe.targetPath??"")||typeof m.probe.expectedRedText!=="string"
    ||!m.probe.expectedRedText.trim()||m.probe.expectedRedText.length>2000)throw Error("TRACKED_REPAIR_PROBE_INVALID");
  if(!exact(m.model,"endpoint,id,nPredict,sha256,timeoutMs")||!digest(m.model.sha256)||typeof m.model.id!=="string"||!m.model.id||m.model.id.length>256
    ||!Number.isInteger(m.model.nPredict)||m.model.nPredict<1||m.model.nPredict>2048||!Number.isInteger(m.model.timeoutMs)||m.model.timeoutMs<1||m.model.timeoutMs>600000)
    throw Error("TRACKED_REPAIR_MODEL_INVALID");
  const endpoint=new URL(m.model.endpoint);
  if(endpoint.protocol!=="http:"||endpoint.hostname!=="127.0.0.1"||endpoint.pathname!=="/completion"||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)
    throw Error("TRACKED_REPAIR_MODEL_ENDPOINT_INVALID");
  if(!exact(m.verifier,"publicKeyFile,publicKeySha256,receiptFile")||!isAbsolute(m.verifier.publicKeyFile??"")||!isAbsolute(m.verifier.receiptFile??"")||!digest(m.verifier.publicKeySha256))
    throw Error("TRACKED_REPAIR_VERIFIER_INVALID");
  const targets=[...m.trackedFiles.map(f=>f.path),m.probe.targetPath].sort();
  if(JSON.stringify([...m.sequence.jobs[0]!.targetFiles].sort())!==JSON.stringify(targets)||!/^[a-f0-9]{40}$/.test(m.sequence.jobs[0]!.baseRevision))
    throw Error("TRACKED_REPAIR_TARGET_MISMATCH");
  for(const root of [m.workspace,m.baselineWorkspace])assertExternalRuntimePath(root,[]);
  const authorities=[file,m.probe.file,m.verifier.publicKeyFile,m.verifier.receiptFile,m.verifier.receiptFile+".request.json"];
  if(new Set(authorities).size!==authorities.length)throw Error("TRACKED_REPAIR_AUTHORITY_OVERLAP");
  for(const authority of authorities)assertExternalRuntimePath(authority,[m.workspace,m.baselineWorkspace]);
  if(hash(readBoundedRuntimeFile(m.probe.file,131072))!==m.probe.sha256)throw Error("TRACKED_REPAIR_PROBE_PIN_MISMATCH");
  const publicKey=readBoundedRuntimeFile(m.verifier.publicKeyFile,8192);
  if(hash(publicKey)!==m.verifier.publicKeySha256)throw Error("SIGNED_LOCAL_VERIFIER_PUBLIC_KEY_PIN_MISMATCH");
  if(!publicKey.toString("utf8").startsWith("-----BEGIN PUBLIC KEY-----")||createPublicKey(publicKey).asymmetricKeyType!=="ed25519")throw Error("TRACKED_REPAIR_PUBLIC_KEY_INVALID");
  if(goal)validateResidentDevelopmentSequence(m.sequence,goal,{taskScopeId:m.sequence.taskScopeId,maxRisk:"low"});
  return {manifest:m,pin};
}

export function createTrackedRepairResidentRuntime(input:{env:Record<string,string|undefined>;runtimeRoot:string;compassPath:string;goal:Goal;
  fetchImpl?:typeof fetch;resourceAdmission?:typeof withDevelopmentResourceAdmission}):ResidentDevelopmentGoalHost|null {
  const loaded=readTrackedRepairManifest(input.env,input.goal); if(!loaded)return null;
  const {manifest:m,pin}=loaded;
  if(contains(m.workspace,input.runtimeRoot)||contains(input.runtimeRoot,m.workspace))throw Error("TRACKED_REPAIR_RUNTIME_OVERLAP");
  const sequence={...m.sequence,executionContractDigest:pin},base=m.sequence.jobs[0]!.baseRevision;
  const stateRoot=join(dirname(input.compassPath),"self-development"),privateRoot=join(stateRoot,"tracked-repair");
  assertExternalRuntimePath(privateRoot,[m.workspace,m.baselineWorkspace]); mkdirSync(privateRoot,{recursive:true,mode:0o700});
  const key=readBoundedRuntimeFile(m.verifier.publicKeyFile,8192).toString("utf8");
  const probe=readBoundedRuntimeFile(m.probe.file,131072);
  const readback=fileURLToPath(new URL("../../scripts/jarvis-local-artifact-readback.mjs",import.meta.url));
  const attest=(workspace:string,trackedEdits?:unknown):Attestation=>{
    const run=spawnSync(process.execPath,[readback],{input:JSON.stringify({workspace,baseRevision:base,targetPath:trackedEdits?m.targetPath:m.probe.targetPath,
      allowedUntracked:[m.probe.targetPath],...(trackedEdits?{trackedEdits}:{})}),encoding:"utf8",timeout:15000,maxBuffer:131072,windowsHide:true});
    const payload=JSON.parse(run.stdout||"null");
    if(run.status!==0||run.error||payload?.ok!==true)throw Error(payload?.blocker??"TRACKED_REPAIR_READBACK_FAILED");
    return payload.attestation as Attestation;
  };
  const ensureProbe=(workspace:string)=>{
    const target=assertExternalRuntimePath(join(workspace,m.probe.targetPath),[]);
    if(existsSync(target)){if(hash(readBoundedRuntimeFile(target,131072))!==m.probe.sha256)throw Error("TRACKED_REPAIR_FROZEN_PROBE_CHANGED");}
    else writeFileSync(target,probe,{flag:"wx",mode:0o600});
  };
  const scope=()=>{if(Date.parse(m.sequence.expiresAt)<=Date.now())throw Error("TRACKED_REPAIR_EXPIRED");};
  const redPath=(jobId:string)=>join(privateRoot,hash(jobId)+".red.json");
  const preparedPath=(jobId:string)=>join(privateRoot,hash(jobId)+".prepared.json");
  const loadPrepared=(jobId:string):{binding:string;files:Array<{path:string;content:string}>;responseSha256:string;promptSha256:string}=>{
    const record=JSON.parse(readBoundedRuntimeFile(preparedPath(jobId),262144).toString("utf8"));
    if(record.binding!==hash(pin+"\0"+jobId)||!Array.isArray(record.files)||!record.files.length||record.files.length>m.trackedFiles.length
      ||record.files.some((f:{path:string;content:string})=>!m.trackedFiles.some(p=>p.path===f.path)||typeof f.content!=="string"||Buffer.byteLength(f.content)>131072)
      ||new Set(record.files.map((f:{path:string})=>f.path)).size!==record.files.length||!digest(record.responseSha256)||!digest(record.promptSha256))
      throw Error("TRACKED_REPAIR_PREPARED_BINDING_INVALID");
    return record;
  };
  const candidate=(jobId:string)=>{
    ensureProbe(m.workspace); const p=loadPrepared(jobId);
    const trackedEdits={version:2,files:p.files.map(f=>({path:f.path,beforeSha256:m.trackedFiles.find(p=>p.path===f.path)!.beforeSha256,afterSha256:hash(f.content)}))};
    return {prepared:p,trackedEdits,identity:attest(m.workspace,trackedEdits)};
  };
  return new ResidentDevelopmentGoalHost({jobs:new JsonFileDevelopmentJobStore(join(stateRoot,"jobs.json")),
    changeSets:new JsonFileDevelopmentChangeSetStore(join(stateRoot,"change-sets.json")),
    planning:{requirementIds:["CORE-014"],baseRevision:base,taskScopeId:sequence.taskScopeId,maxRisk:"low",targetFiles:sequence.jobs[0]!.targetFiles,contextDigest:sequence.goalDigest,sequence},
    stages:{builderId,deferMissingVerification:true,
      async build({job,workItemId}){
        scope(); ensureProbe(m.workspace);
        if(workItemId.endsWith(":test")){
          const identity=attest(m.workspace);
          return createDevelopmentChangeSet({changeSetId:job.jobId+":tracked-red",jobId:job.jobId,workItemId,deviceId:builderId,baseRevision:base,
            changedPaths:[m.probe.targetPath],affectedSymbols:[],patchDigest:identity.patchDigest,candidateRevision:identity.candidateRevision,
            artifactDigest:m.probe.sha256,evidenceDigest:hash(probe),tddPhase:"red",tddEvidenceDigest:hash(probe),rollback:{kind:"git-base",reference:base}});
        }
        if(!existsSync(preparedPath(job.jobId))){
          const intent=preparedPath(job.jobId)+".intent.json";
          if(existsSync(intent))throw Error("TRACKED_REPAIR_INFERENCE_INTERRUPTED_NO_RETRY");
          attest(m.workspace);
          const files=m.trackedFiles.map(f=>{
            const content=readBoundedRuntimeFile(join(m.workspace,f.path),131072).toString("utf8");
            if(hash(content)!==f.beforeSha256)throw Error("TRACKED_REPAIR_BEFORE_PIN_MISMATCH");return {path:f.path,content};
          });
          const item=job.workItems.find(item=>item.id===workItemId);
          if(!item)throw Error("TRACKED_REPAIR_WORK_ITEM_UNKNOWN");
          const prompt=files.map(f=>"SOURCE "+f.path+"\n"+f.content).join("\n")+"\n"+
            m.slots.map(slot=>"SLOT "+slot.id+" in "+slot.path+"; exact selected before text:\n"+slot.before).join("\n")+
            "\nThe trusted frozen regression failed on the original baseline. Objective: "+item.objective+"\n"+
            "Return ONLY JSON {\"edits\":[{\"slot\":1,\"after\":\"replacement text\"}]}. "+
            "Slots identify exact before strings; use each selected slot once. No paths/commands/permissions/tests may be added. Preserve unselected source.";
          if(Buffer.byteLength(prompt)>30000)throw Error("TRACKED_REPAIR_PROMPT_TOO_LARGE");
          const admit=input.resourceAdmission??withDevelopmentResourceAdmission;
          const response=await admit(async()=>{
            const fetcher=input.fetchImpl??fetch,templateUrl=new URL("/apply-template",m.model.endpoint).href;
            const rendered=JSON.parse(await modelBody(await fetcher(templateUrl,{method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),headers:{"content-type":"application/json"},
              body:JSON.stringify({messages:[{role:"system",content:"You are a bounded source repair capability. Return only the requested JSON."},{role:"user",content:prompt}],add_generation_prompt:true,chat_template_kwargs:{enable_thinking:false}})})));
            if(typeof rendered.prompt!=="string"||Buffer.byteLength(rendered.prompt)>65536||!rendered.prompt.endsWith("<|im_start|>assistant\n"))throw Error("TRACKED_REPAIR_MODEL_TEMPLATE_INVALID");
            writeFileSync(intent,JSON.stringify({binding:hash(pin+"\0"+job.jobId),model:m.model,workItemId,prompt,renderedPrompt:rendered.prompt,promptSha256:hash(prompt),at:new Date().toISOString()}),{flag:"wx",mode:0o600});
            const reply=await fetcher(m.model.endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(m.model.timeoutMs),headers:{"content-type":"application/json"},
              body:JSON.stringify({prompt:rendered.prompt,n_predict:m.model.nPredict,temperature:0,cache_prompt:false,json_schema:{type:"object",properties:{edits:{type:"array",minItems:1,maxItems:m.slots.length,
                items:{type:"object",properties:{slot:{type:"integer",enum:m.slots.map(s=>s.id)},after:{type:"string",minLength:1,maxLength:16000}},required:["slot","after"],additionalProperties:false}}},required:["edits"],additionalProperties:false}})});
            const raw=await modelBody(reply);writeFileSync(preparedPath(job.jobId)+".response.json",raw,{flag:"wx",mode:0o600});return raw;
          },{kind:"local-model",directory:m.workspace});
          const payload=JSON.parse(response);
          if(payload.stop!==true||payload.truncated!==false||!["eos","word"].includes(payload.stop_type)||payload.model!==m.model.id||typeof payload.content!=="string")throw Error("TRACKED_REPAIR_MODEL_REPLY_INVALID");
          const answer=JSON.parse(payload.content);
          if(!exact(answer,"edits")||!Array.isArray(answer.edits)||!answer.edits.length||answer.edits.length>m.slots.length)throw Error("TRACKED_REPAIR_EDIT_SCHEMA_INVALID");
          const content=new Map(files.map(f=>[f.path,f.content])),seen=new Set<number>();
          for(const edit of answer.edits){
            if(!exact(edit,"after,slot")||typeof edit.after!=="string"||!edit.after.length||edit.after.length>16000||typeof edit.slot!=="number"||seen.has(edit.slot))throw Error("TRACKED_REPAIR_EDIT_SCHEMA_INVALID");
            const slot=m.slots.find(s=>s.id===edit.slot);if(!slot)throw Error("TRACKED_REPAIR_EDIT_SCOPE_INVALID");seen.add(edit.slot);
            const old=content.get(slot.path)!;if(old.split(slot.before).length!==2)throw Error("TRACKED_REPAIR_SLOT_NOT_UNIQUE");content.set(slot.path,old.replace(slot.before,edit.after));
          }
          const changed=[...content].filter(([path,value])=>hash(value)!==m.trackedFiles.find(p=>p.path===path)!.beforeSha256).map(([path,content])=>({path,content}));
          if(!changed.some(f=>f.path===m.targetPath))throw Error("TRACKED_REPAIR_NO_TARGET_CHANGE");
          scope();attest(m.workspace);
          for(const f of m.trackedFiles)if(hash(readBoundedRuntimeFile(join(m.workspace,f.path),131072))!==f.beforeSha256)throw Error("TRACKED_REPAIR_SOURCE_CHANGED_DURING_INFERENCE");
          writeFileSync(preparedPath(job.jobId),JSON.stringify({binding:hash(pin+"\0"+job.jobId),files:changed,responseSha256:hash(response),promptSha256:hash(prompt)}),{flag:"wx",mode:0o600});
        }
        const prepared=loadPrepared(job.jobId);
        for(const f of prepared.files){
          const target=assertExternalRuntimePath(join(m.workspace,f.path),[]),current=hash(readBoundedRuntimeFile(target,131072));
          if(current!==m.trackedFiles.find(p=>p.path===f.path)!.beforeSha256&&current!==hash(f.content))throw Error("TRACKED_REPAIR_PREPARED_SOURCE_CONFLICT");
        }
        for(const f of prepared.files){const target=join(m.workspace,f.path);if(hash(readBoundedRuntimeFile(target,131072))!==hash(f.content))writeFileSync(target,f.content);}
        scope();const c=candidate(job.jobId);
        return createDevelopmentChangeSet({changeSetId:job.jobId+":tracked-candidate",jobId:job.jobId,workItemId,deviceId:builderId,baseRevision:base,
          changedPaths:[...prepared.files.map(f=>f.path),m.probe.targetPath],affectedSymbols:[],patchDigest:c.identity.patchDigest,candidateRevision:c.identity.candidateRevision,
          artifactDigest:c.identity.artifactDigest,evidenceDigest:hash(JSON.stringify(prepared)),rollback:{kind:"git-base",reference:base}});
      },
      async verifyRed({job}){
        scope();ensureProbe(m.baselineWorkspace);attest(m.baselineWorkspace);
        for(const f of m.trackedFiles)if(hash(readBoundedRuntimeFile(join(m.baselineWorkspace,f.path),131072))!==f.beforeSha256)throw Error("TRACKED_REPAIR_RED_BASELINE_CHANGED");
        const existing=redPath(job.jobId);
        if(existsSync(existing)){
          const bytes=readBoundedRuntimeFile(existing,8192),record=JSON.parse(bytes.toString("utf8"));
          if(record.contract!==pin||record.jobId!==job.jobId||record.probeSha256!==m.probe.sha256||record.exit!==1||!digest(record.outputSha256))throw Error("TRACKED_REPAIR_RED_RECORD_CONFLICT");
          return {digest:hash(bytes),issuer:"trusted-baseline-probe"};
        }
        let output="",status=0;
        try {output=execFileSync(process.execPath,["--test",m.probe.targetPath],{cwd:m.baselineWorkspace,env:{PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??""},encoding:"utf8",timeout:30000,maxBuffer:1048576,windowsHide:true});}
        catch(error){const e=error as {status?:number;stdout?:string;stderr?:string};status=e.status??-1;output=String(e.stdout??"")+String(e.stderr??"");}
        if(status!==1||!output.includes(m.probe.expectedRedText))throw Error("TRACKED_REPAIR_RED_NOT_PROVEN");
        attest(m.baselineWorkspace);writeFileSync(redPath(job.jobId)+".log",output,{flag:"wx",mode:0o600});
        const evidence={contract:pin,jobId:job.jobId,probeSha256:m.probe.sha256,exit:status,outputSha256:hash(output)};
        const file=redPath(job.jobId),bytes=JSON.stringify(evidence);if(existsSync(file)){if(readBoundedRuntimeFile(file,8192).toString("utf8")!==bytes)throw Error("TRACKED_REPAIR_RED_RECORD_CONFLICT");}
        else writeFileSync(file,bytes,{flag:"wx",mode:0o600});return {digest:hash(bytes),issuer:"trusted-baseline-probe"};
      },
      async verify({job,changeSet,plan}){
        scope();const c=candidate(job.jobId);
        if(c.identity.candidateRevision!==plan.sourceRevision||c.identity.artifactDigest!==plan.artifactDigest)throw Error("TRACKED_REPAIR_CANDIDATE_BINDING_MISMATCH");
        if(!existsSync(m.verifier.receiptFile)){
          const request={version:2,kind:"tracked-repair-verifier-request",executionContractDigest:pin,expiresAt:sequence.expiresAt,
            request:{goalId:job.goalId,jobId:job.jobId,changeSetId:changeSet.changeSetId,builderId,baseRevision:base,sourceRevision:plan.sourceRevision,artifactDigest:plan.artifactDigest,
              targetPath:m.targetPath,allowedUntracked:[m.probe.targetPath],trackedEdits:c.trackedEdits,requiredChecks:checks},
            files:[...c.prepared.files.map(f=>({path:f.path,sha256:hash(f.content),contentBase64:Buffer.from(f.content).toString("base64")})),
              {path:m.probe.targetPath,sha256:m.probe.sha256,contentBase64:probe.toString("base64")} ]};
          const file=m.verifier.receiptFile+".request.json",bytes=JSON.stringify(request)+"\n";mkdirSync(dirname(file),{recursive:true,mode:0o700});
          if(existsSync(file)){if(readBoundedRuntimeFile(file,1048576).toString("utf8")!==bytes)throw Error("TRACKED_REPAIR_REQUEST_CONFLICT");}
          else writeFileSync(file,bytes,{flag:"wx",mode:0o600});return [];
        }
        const receipt=JSON.parse(readBoundedRuntimeFile(m.verifier.receiptFile,24576,[m.workspace,m.baselineWorkspace]).toString("utf8"));
        return validateSignedLocalVerifierReceipt({receipt,publicKeyPem:key,plan,changeSet,goalId:job.goalId});
      },
      async acceptanceEvidence({job,changeSet,plan}){
        scope();const c=candidate(job.jobId);
        if(c.identity.candidateRevision!==plan.sourceRevision||c.identity.artifactDigest!==plan.artifactDigest)throw Error("TRACKED_REPAIR_ACCEPTANCE_SOURCE_CHANGED");
        const receipt=JSON.parse(readBoundedRuntimeFile(m.verifier.receiptFile,24576,[m.workspace,m.baselineWorkspace]).toString("utf8"));
        const evidence=validateSignedLocalVerifierReceipt({receipt,publicKeyPem:key,plan,changeSet,goalId:job.goalId});
        if(!checks.every(check=>evidence.some(e=>e.check===check&&e.status==="passed")))throw Error("TRACKED_REPAIR_CHECKS_INCOMPLETE");
        return job.definitionOfDone.map(criterion=>({id:job.jobId+":"+criterion.id,criterionId:criterion.id,kind:"tracked-repair-frozen-probe-and-signed-suite",
          issuer:receipt.payload.verifierId,verified:true,sourceRevision:plan.sourceRevision,artifactDigest:plan.artifactDigest,environment:m.probe.targetPath,recordedAt:new Date().toISOString()}));
      },
      async releaseState(){return {connected:false,taskScopeId:sequence.taskScopeId,protectedConditions:[],classifications:{destructiveChangeAbsent:true,privilegedChangeAbsent:true},
        pullRequest:null,mainCi:null,deployment:null,postDeploymentEvidence:null};},
    }});
}
