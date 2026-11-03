import { createHash } from "node:crypto";
import type { CompassStore, GoalRecord, StateRecord } from "../compass/store.ts";
import { compassGoalToLoopGoal } from "./compass-state-store.ts";
import { goalWorkStateId } from "./work-state-integration.ts";
import { normalizeIntake, type GoalContractSeed, type NormalizedIntake } from "./goal-controller-runtime.ts";
import { canonicalRequirementBlockers } from "./owner-requirement-canonical.ts";
import type { WorkState } from "./work-state.ts";

const KIND="jarvis-approved-next-work",VERSION=1;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const idValid=(v:unknown)=>typeof v==="string"&&/^[A-Za-z0-9:_-]{1,128}$/.test(v);
const seed=(request:NormalizedIntake)=>({title:request.text.slice(0,120),description:request.text,
 successCriteria:request.goalContract!.successCriteria,constraints:request.goalContract!.constraints??[]});
const seedId=(input:ReturnType<typeof seed>)=>goalWorkStateId(input);
export interface ApprovedNextWorkInput {afterGoalId:string;taskScopeId:string;text:string;goalContract:GoalContractSeed;idempotencyKey?:string;expiresAt:string;}
export interface ApprovedNextWorkRecord {id:string;afterGoalId:string;targetGoalId:string;taskScopeId:string;expiresAt:string;createdAt:string;request:NormalizedIntake;requestDigest:string;status:"QUEUED"|"PROMOTED"|"STARTED";}
interface Envelope {kind:typeof KIND;version:typeof VERSION;records:ApprovedNextWorkRecord[];}
function binding(row:ApprovedNextWorkRecord){return hash({afterGoalId:row.afterGoalId,targetGoalId:row.targetGoalId,taskScopeId:row.taskScopeId,expiresAt:row.expiresAt,request:row.request});}
function envelope(active:unknown[]):Envelope {
 const rows=active.filter(v=>object(v)&&v.kind===KIND);
 if(rows.length>1)throw Error("NEXT_WORK_STATE_INVALID");
 if(!rows.length)return {kind:KIND,version:VERSION,records:[]};
 const value=rows[0] as unknown as Envelope;
 if(value.version!==VERSION||!Array.isArray(value.records)||value.records.length>128)throw Error("NEXT_WORK_STATE_INVALID");
 const seen=new Set<string>();
 for(const row of value.records){
  if(!row||!/^[a-f0-9]{64}$/.test(row.id)||seen.has(row.id)||!idValid(row.afterGoalId)||!idValid(row.targetGoalId)
   ||!/^issue:[1-9]\d{0,9}$/.test(row.taskScopeId)||!Number.isFinite(Date.parse(row.expiresAt))
   ||!["QUEUED","PROMOTED","STARTED"].includes(row.status)||row.requestDigest!==binding(row)
   ||!row.request?.goalContract||seedId(seed(row.request))!==row.targetGoalId
   ||row.request.idempotencyKey!=="next-work:"+row.id)throw Error("NEXT_WORK_STATE_INVALID");
  seen.add(row.id);
 }
 return structuredClone(value);
}
function replace(active:unknown[],value:Envelope){return [...active.filter(v=>!(object(v)&&v.kind===KIND)),value];}
function currentId(goal:GoalRecord|null){return goal?goalWorkStateId(compassGoalToLoopGoal(goal)):null;}
function stopped(state:StateRecord,id:string):boolean {
 return state.status!==null&&!["COMPLETED","IN_PROGRESS","RUNNING","ACTIVE","VERIFYING"].includes(state.status)
  ||state.blockers.length>0||canonicalRequirementBlockers(state.active,id).length>0;
}
function completed(goal:GoalRecord,state:StateRecord,id:string):boolean {
 if(currentId(goal)!==id||stopped(state,id))return false;
 const work=state.active.filter(v=>object(v)&&v.kind==="gai-work-state"&&v.goalId===id);
 const runs=state.active.filter(v=>object(v)&&v.kind==="jarvis-work-runs");
 if(work.length!==1||runs.length!==1)return false;
 const ws=(work[0] as {state?:WorkState}).state,rr=(runs[0] as {runs?:Array<{goalId:string;phase:string}>}).runs?.filter(r=>r.goalId===id);
 if(!ws||ws.goalId!==id||ws.status!=="COMPLETED"||!rr||rr.length!==1||rr[0]!.phase!=="COMPLETED"
  ||!Array.isArray(ws.definitionOfDone)||!ws.definitionOfDone.length||!Array.isArray(ws.verificationResults)
  ||!Array.isArray(ws.blockers)||ws.blockers.length||!Array.isArray(ws.childWorkItems)||ws.childWorkItems.some(x=>x.status!=="COMPLETED"))return false;
 const criteria=goal.successCriteria;
 if(!criteria.length||ws.definitionOfDone.length!==criteria.length||ws.definitionOfDone.some((c,i)=>c.id!==`criterion-${i+1}`||c.description!==criteria[i]||c.required!==true))return false;
 return ws.definitionOfDone.every(c=>ws.verificationResults.some(r=>r.itemId===c.id&&r.passed===true&&!r.waived&&r.evidence!==undefined&&r.evidence!==null));
}

/** Trusted Owner-admin integration only. Persisted context/model proposals do
 * not call accept(). Queue expiry bounds adoption; later execution retains the
 * normal task authorization, verification and non-bypassable Human Gates. */
export class CompassApprovedNextWork {
 private readonly compass:CompassStore;private readonly now:()=>Date;
 constructor(compass:CompassStore,now:()=>Date=()=>new Date()){this.compass=compass;this.now=now;}
 list(){return envelope(this.compass.getState().active).records;}
 pending(){const now=this.now().getTime();return this.list().filter(r=>r.status==="PROMOTED"||r.status==="QUEUED"&&Date.parse(r.expiresAt)>now);}
 accept(raw:unknown):ApprovedNextWorkRecord {
  if(!object(raw))throw Error("NEXT_WORK_INVALID");
  const input=raw as unknown as ApprovedNextWorkInput;
  if(Object.keys(input).some(k=>!["afterGoalId","taskScopeId","text","goalContract","idempotencyKey","expiresAt"].includes(k))
   ||!idValid(input.afterGoalId)||typeof input.taskScopeId!=="string"||!/^issue:[1-9]\d{0,9}$/.test(input.taskScopeId)
   ||typeof input.text!=="string"||!input.text.trim()||input.text.length>4000||!input.goalContract
   ||input.idempotencyKey!==undefined&&(typeof input.idempotencyKey!=="string"||!input.idempotencyKey.trim()||input.idempotencyKey.length>256)
   ||typeof input.expiresAt!=="string"||!Number.isFinite(Date.parse(input.expiresAt))||new Date(input.expiresAt).toISOString()!==input.expiresAt)throw Error("NEXT_WORK_INVALID");
  const now=this.now(),normalized=normalizeIntake({source:"jarvis",text:input.text,goalContract:input.goalContract,idempotencyKey:input.idempotencyKey,
   sourceContext:{taskScopeId:input.taskScopeId,afterGoalId:input.afterGoalId}});
  const id=hash(normalized.idempotencyKey),request={...normalized,id:"next-work-"+id,idempotencyKey:"next-work:"+id};
  const row:ApprovedNextWorkRecord={id,afterGoalId:input.afterGoalId,targetGoalId:seedId(seed(request)),taskScopeId:input.taskScopeId,expiresAt:input.expiresAt,createdAt:now.toISOString(),request,requestDigest:"",status:"QUEUED"};row.requestDigest=binding(row);
  let accepted=row;
  this.compass.updateActive(active=>{const e=envelope(active),prior=e.records.find(r=>r.id===id);
   if(prior){if(prior.requestDigest!==row.requestDigest)throw Error("NEXT_WORK_IDEMPOTENCY_CONFLICT");accepted=prior;return active;}
   if(Date.parse(row.expiresAt)<=now.getTime())throw Error("NEXT_WORK_EXPIRED");
   if(Date.parse(row.expiresAt)>now.getTime()+7*24*3600000)throw Error("NEXT_WORK_INVALID");
   if(row.afterGoalId!==currentId(this.compass.getGoal()))throw Error("NEXT_WORK_PREDECESSOR_MISMATCH");
   if(row.targetGoalId===row.afterGoalId)throw Error("NEXT_WORK_SAME_GOAL");
   if(e.records.length>=128||e.records.filter(r=>r.status!=="STARTED"&&Date.parse(r.expiresAt)>now.getTime()).length>=16)throw Error("NEXT_WORK_STORAGE_REVIEW_REQUIRED");
   return replace(active,{...e,records:[...e.records,row]});
  });return structuredClone(accepted);
 }
 promote(id:string):ApprovedNextWorkRecord|null {
  let result:ApprovedNextWorkRecord|null=null;
  this.compass.promoteGoal((goal,state)=>{const e=envelope(state.active),row=e.records.find(r=>r.id===id);if(!goal||!row||stopped(state,currentId(goal)!))return null;
   if(row.status!=="QUEUED"){if(currentId(goal)===row.targetGoalId)result=row;return null;}
   if(Date.parse(row.expiresAt)<=this.now().getTime()||!completed(goal,state,row.afterGoalId))return null;
   // Existing Goal identities cannot inherit historical verification/cached work.
   if(state.active.some(v=>object(v)&&(v.kind==="gai-work-state"&&v.goalId===row.targetGoalId
    ||v.kind==="jarvis-work-runs"&&Array.isArray(v.runs)&&v.runs.some(r=>object(r)&&r.goalId===row.targetGoalId))))throw Error("NEXT_WORK_TARGET_ALREADY_EXISTS");
   result={...row,status:"PROMOTED"};const active=replace(state.active,{...e,records:e.records.map(r=>r.id===id?result!:r)});
   active.push({kind:"gai-retired-goal",version:1,goalId:row.afterGoalId,record:goal,successorGoalId:row.targetGoalId,handoffId:row.id,retiredAt:this.now().toISOString()});
   if(Date.parse(row.expiresAt)<=this.now().getTime()){result=null;return null;}
   return {goal:seed(row.request),active};
  });return result;
 }
 started(id:string,targetGoalId:string):void {
  this.compass.updateActive(active=>{const e=envelope(active),row=e.records.find(r=>r.id===id);
   if(!row||row.status==="QUEUED"||row.targetGoalId!==targetGoalId||currentId(this.compass.getGoal())!==targetGoalId)throw Error("NEXT_WORK_START_BINDING_INVALID");
   return replace(active,{...e,records:e.records.map(r=>r.id===id?{...r,status:"STARTED"}:r)});
  });
 }
}
