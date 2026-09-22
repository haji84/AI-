import { recordLearningStep, requestLearningCorrection, correctedLearningSteps, type TeachingLearning } from "./teaching-learning.ts";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
export type TeachingPlatform = "android" | "ios" | "windows" | "macos" | "linux";
export type DeviceProfile = { deviceId: string; platform: TeachingPlatform; model: string; osVersion: string; app: string; appVersion: string };
export type TeachingAction = { kind: "tap"; selector: string } | { kind: "key"; key: "BACK" | "HOME" | "APP_SWITCH" } | { kind: "url"; host: string } | { kind: "manual"; instruction: string };
export type TeachingStep = { action: TeachingAction; before: string; after: string; gate: boolean; contextKey?: string };
export type TeachingVariant = { id: string; goal: string; completion: string; scope: "device" | "model" | "common"; profile: DeviceProfile; status: "RECORDING" | "DRAFT" | "VERIFIED"; sessionId?: string; steps: TeachingStep[]; finalScreen: string; createdAt: string; verifiedRunId?: string; learning?: TeachingLearning };
export type TeachingRun = { id: string; variantId: string; deviceId: string; profileKey: string; mode: "verify" | "execute"; status: "RUNNING" | "PASSED" | "FAILED" | "NEEDS_HUMAN"; nextStep: number; pendingStep?: number; reason?: string; startedAt: string; finishedAt?: string };
export type Observation = { signature: string; profile: DeviceProfile; targets: Array<{ selector: string; labelHash?: string; x: number; y: number; left: number; top: number; right: number; bottom: number; safeNavigation: boolean }>; protectedScreen: boolean };
export interface TeachingAdapter { observe(): Promise<Observation>; execute(action: TeachingAction, observation: Observation, url?: string): Promise<void>; authorize(): void | Promise<void> }
export const platforms: TeachingPlatform[] = ["android", "ios", "windows", "macos", "linux"];
function text(value: unknown, label: string, max = 160): string { if (typeof value !== "string" || !value.trim() || value.length > max || [...value].some(c=>c.charCodeAt(0)<9)) throw Error(`Invalid ${label}`); return value.trim(); }
export function profile(value: unknown): DeviceProfile {
 const p=value as DeviceProfile;if(!p||!platforms.includes(p.platform))throw Error("Unsupported platform");
 return {deviceId:text(p.deviceId,"device",120),platform:p.platform,model:text(p.model,"model"),osVersion:text(p.osVersion,"OS"),app:text(p.app,"app"),appVersion:text(p.appVersion,"app version")};
}
export function profileKey(p: DeviceProfile) {return createHash("sha256").update(JSON.stringify([p.platform,p.model,p.osVersion,p.app,p.appVersion])).digest("hex");}
export function matchesVariant(v: TeachingVariant,p: DeviceProfile): boolean {
 if(v.profile.platform!==p.platform||v.profile.osVersion!==p.osVersion||v.profile.app!==p.app||v.profile.appVersion!==p.appVersion)return false;
 if(v.scope==="device")return v.profile.deviceId===p.deviceId&&v.profile.model===p.model;
 if(v.scope==="model")return v.profile.model===p.model&&!Object.values(p).includes("unknown");
 return !Object.values(p).includes("unknown")&&v.steps.every(s=>s.action.kind!=="tap"&&s.action.kind!=="manual");
}
export function selectVariant(variants: TeachingVariant[],goal: string,p: DeviceProfile) {
 const eligible=variants.filter(v=>v.goal===goal&&matchesVariant(v,p));
 return eligible.sort((a,b)=>({device:3,model:2,common:1}[b.scope]-{device:3,model:2,common:1}[a.scope])||b.createdAt.localeCompare(a.createdAt))[0]??null;
}
export function safeUrl(value: unknown,host?:string):string {
 const url=new URL(text(value,"URL",2048));
 if(url.protocol!=="https:"||url.username||url.password||url.hash||[...url.searchParams.keys()].some(k=>/token|secret|password|auth|key/i.test(k))||(host&&url.hostname!==host))throw Error("URL requires HTTPS, matching host and no credentials");
 return url.href;
}
export class TeachingStore {
 private data:{version:1;variants:TeachingVariant[];runs:TeachingRun[]}={version:1,variants:[],runs:[]};
 private persisted = structuredClone(this.data);
 private readonly file: string;
 constructor(file: string) {
  this.file = file;
  try {const raw=readFileSync(file,"utf8");if(raw.length>8*1024*1024)throw Error("Teaching storage limit");const d=JSON.parse(raw);if(d.version!==1||!Array.isArray(d.variants)||!Array.isArray(d.runs))throw Error("Invalid teaching storage");this.data=d;this.persisted=structuredClone(d);
   let changed=false;for(const r of this.data.runs)if(r.status==="RUNNING"){r.status="NEEDS_HUMAN";r.reason="再起動後：実行途中の操作は自動再送しません";changed=true;}for(const v of this.data.variants)if(v.status==="RECORDING"){v.status="DRAFT";delete v.sessionId;changed=true;}if(changed)this.save();
  }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 }
 private save(){try{mkdirSync(dirname(this.file),{recursive:true});const s=JSON.stringify(this.data);if(s.length>8*1024*1024)throw Error("Teaching storage limit");const temp=this.file+".tmp";writeFileSync(temp,s,{mode:0o600});renameSync(temp,this.file);this.persisted=structuredClone(this.data);}catch(error){this.data=structuredClone(this.persisted);throw error;}}
 list(){return structuredClone(this.data);}
 get(id:string){const v=this.data.variants.find(v=>v.id===id);if(!v)throw Error("Procedure not found");return structuredClone(v);}
 recording(sessionId:string){const v=this.data.variants.find(v=>v.sessionId===sessionId&&v.status==="RECORDING");return v?structuredClone(v):null;}
 start(input:{goal:unknown;scope:unknown;profile:unknown;sessionId?:string}){
  if(this.data.variants.length>=500)throw Error("Procedure capacity reached");
  if(!["device","model","common"].includes(String(input.scope)))throw Error("Invalid scope");
  if(input.sessionId&&(this.recording(input.sessionId)||this.data.variants.some(v=>v.status==='RECORDING'&&v.profile.deviceId===profile(input.profile).deviceId)))throw Error("Already recording");
  const v:TeachingVariant={id:randomUUID(),goal:text(input.goal,"goal"),completion:"",scope:input.scope as TeachingVariant["scope"],profile:profile(input.profile),status:input.sessionId?"RECORDING":"DRAFT",sessionId:input.sessionId,steps:[],finalScreen:"",createdAt:new Date().toISOString()};this.data.variants.push(v);this.save();return structuredClone(v);
 }
 append(id:string,step:TeachingStep){const v=this.data.variants.find(v=>v.id===id);if(!v||v.status!=="RECORDING"||v.steps.length>=50)throw Error("Recording unavailable or step limit reached");v.learning=recordLearningStep(v,step);v.steps.push(structuredClone(step));this.save();}
 requestCorrection(id:string){const v=this.data.variants.find(v=>v.id===id);if(!v||v.status!=="RECORDING"||!v.steps.length)throw Error("Correction requires active recording");v.learning=requestLearningCorrection(v);this.save();return this.get(id);}
 resumeCorrection(id:string,observation:Observation){const v=this.data.variants.find(v=>v.id===id);if(!v||v.status!=="RECORDING")throw Error("Correction requires active recording");const steps=correctedLearningSteps(v,observation);if(!steps)return false;v.steps=steps;delete v.learning!.pendingCorrection;this.save();return true;}
 manual(input:{goal:unknown;scope:unknown;profile:unknown;instructions:unknown;completion:unknown}){
  if(typeof input.instructions!=="string")throw Error("Instructions required");const lines=input.instructions.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!lines.length||lines.length>50)throw Error("1–50 steps required");const instructions=lines.map(s=>text(s,"instruction",500));const completion=text(input.completion,"completion",500);
  if(/password|token|secret|パスワード|秘密鍵/i.test(instructions.join(" ")))throw Error("Do not save credentials in teaching steps");
  const v=this.start(input);const stored=this.data.variants.find(r=>r.id===v.id)!;stored.steps=instructions.map(instruction=>({action:{kind:"manual",instruction},before:"",after:"",gate:true}));stored.completion=completion;this.save();return this.get(v.id);
 }
 finish(id:string,completion:unknown,finalScreen:string){const v=this.data.variants.find(v=>v.id===id);if(!v||v.status!=="RECORDING"||!v.steps.length)throw Error("Record at least one action first");if(v.learning?.pendingCorrection)throw Error("Finish correction before saving");const value=text(completion,"completion",500);if(!finalScreen)throw Error("Completion observation required");v.completion=value;v.finalScreen=finalScreen;v.status="DRAFT";delete v.sessionId;this.save();return this.get(id);}
 cancel(id:string){const v=this.data.variants.find(v=>v.id===id);if(!v||v.status!=="RECORDING")throw Error("No active recording");v.status="DRAFT";delete v.sessionId;this.save();}
 beginRun(v:TeachingVariant,p:DeviceProfile,mode:TeachingRun["mode"]){
  if(v.learning?.pendingCorrection)throw Error("Unfinished correction requires a new demonstration");
  if(v.status==="RECORDING"||!v.completion||!v.finalScreen||!v.steps.length||!matchesVariant(v,p))throw Error("Procedure not ready or device/version mismatch");
  if(Object.values(p).includes("unknown"))throw Error("Device/application version must be known before replay");
  if(this.data.runs.length>=2000)throw Error("Run history capacity reached");
  const prior=this.data.runs.filter(r=>r.variantId===v.id&&r.deviceId===p.deviceId&&r.profileKey===profileKey(p));
  if(mode==="execute"&&(!prior.some(r=>r.mode==="verify"&&r.status==="PASSED")||prior.at(-1)?.status!=="PASSED"))throw Error("Verify on this device before automatic execution");
  const r:TeachingRun={id:randomUUID(),variantId:v.id,deviceId:p.deviceId,profileKey:profileKey(p),mode,status:"RUNNING",nextStep:0,startedAt:new Date().toISOString()};this.data.runs.push(r);this.save();return structuredClone(r);
 }
 updateRun(id:string,patch:Partial<Pick<TeachingRun,"status"|"nextStep"|"pendingStep"|"reason">>){const r=this.data.runs.find(r=>r.id===id)!;Object.assign(r,patch);if(r.status!=="RUNNING")r.finishedAt=new Date().toISOString();if(r.status==="PASSED"&&r.mode==="verify"){const v=this.data.variants.find(v=>v.id===r.variantId)!;v.status="VERIFIED";v.verifiedRunId=r.id;}this.save();return structuredClone(r);}
}
const busyDevices=new Set<string>();
export async function replayTeaching(store:TeachingStore,id:string,adapter:TeachingAdapter,mode:TeachingRun["mode"],url?:string){
 await adapter.authorize();const first=await adapter.observe();const v=store.get(id);const device=first.profile.deviceId;if(busyDevices.has(device))throw Error("Device is busy");busyDevices.add(device);let run:TeachingRun|undefined;
 try {
  run=store.beginRun(v,first.profile,mode);const deadline=Date.now()+120000;
  for(let i=0;i<v.steps.length;i++){
   await adapter.authorize();if(Date.now()>deadline)throw Error("Procedure time limit");const step=v.steps[i];const before=await adapter.observe();
   if(profileKey(before.profile)!==(step.contextKey??profileKey(first.profile))||before.profile.deviceId!==device||before.signature!==step.before)throw Error("Screen or device changed; Human Takeover required");
   if(step.gate||before.protectedScreen||step.action.kind==="manual")return store.updateRun(run.id,{status:"NEEDS_HUMAN",reason:"Human Gate: this step needs manual handling",nextStep:i});
   if(step.action.kind==="url")safeUrl(url,step.action.host);
   store.updateRun(run.id,{pendingStep:i});await adapter.authorize();await adapter.execute(step.action,before,url);
   let after=await adapter.observe();for(let attempt=0;after.signature!==step.after&&attempt<2;attempt++){await new Promise(r=>setTimeout(r,300));await adapter.authorize();after=await adapter.observe();}
   if(after.signature!==step.after||after.protectedScreen)throw Error("Expected screen not reached; no automatic retry of input");
   store.updateRun(run.id,{nextStep:i+1,pendingStep:undefined});
  }
  const final=await adapter.observe();if(final.signature!==v.finalScreen||final.protectedScreen)throw Error("Completion screen mismatch or Human Gate");
  return store.updateRun(run.id,{status:"PASSED"});
 } catch(error){if(run)return store.updateRun(run.id,{status:"NEEDS_HUMAN",reason:error instanceof Error?error.message:"Replay failed"});throw error;}
 finally{busyDevices.delete(device);}
}
