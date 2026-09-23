import {resolveOwnerConversation,semanticTerms,type ConversationResolution} from "./owner-conversation.ts";
import { createHash, randomUUID } from "node:crypto";
import type { CompassStore } from "../compass/store.ts";

export const OWNER_REQUIREMENTS_KIND = "jarvis-owner-requirements";
export type RequirementDecision = "idea" | "propose" | "accept" | "withdraw";
export type RequirementState = "IDEA" | "PROPOSED" | "ACCEPTED_REQUIREMENT" | "SPEC_SYNCED" | "SUPERSEDED" | "WITHDRAWN";
export interface RequirementInput { decision: RequirementDecision; statement: string; canonicalIds: string[]; supersedes?: string; }
export interface CanonicalRequirement { id: string; title: string; description: string; required_evidence: string[]; source_decisions?: string[]; }
export interface RequirementMatch { id: string; score: number; reason: "explicit_id" | "text_candidate"; fingerprint: string; }
export interface RequirementPublication { baseSha:string; artifactHash:string; reviewHash:string; branch:string; headSha?:string; prNumber?:number; }
export interface RequirementConversation {inputHash:string;contextHash:string;resolution:ConversationResolution["resolution"];confidence:number;referenceIds:string[];message:string;}
export interface PreparedRequirement {input:RequirementInput|null;requestHash:string;keyDigest:string;conversation?:RequirementConversation;resolution?:ConversationResolution;}
export interface OwnerRequirementRecord {
 id: string; goalId: string | null; state: RequirementState; statement: string;
 requestHash: string; keyDigest: string;
 source: { boundary: "broker_owner_auth"; textSha256: string; recordedAt: string };
 canonicalIds: string[]; matches: RequirementMatch[]; reviewRequired: true;
 supersedes: string[]; supersededBy: string[];
 history: { state: RequirementState; at: string; reason: string }[];
 conversation?: RequirementConversation;
 publication?: RequirementPublication;
 sync?: { canonicalSha256: string; decisionId: string; at: string };
}
interface Envelope { kind: typeof OWNER_REQUIREMENTS_KIND; version: 1; records: OwnerRequirementRecord[]; }
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const canonicalFingerprint = (r: CanonicalRequirement) => sha256(JSON.stringify({id:r.id,title:r.title,description:r.description,required_evidence:r.required_evidence}));
function validPublication(p:RequirementPublication,id:string):boolean {
 return !!p&&typeof p==="object"&&!Array.isArray(p)&&Object.keys(p).every(k=>["baseSha","artifactHash","reviewHash","branch","headSha","prNumber"].includes(k))&&
 /^[a-f0-9]{40}$/.test(p.baseSha)&&/^[a-f0-9]{64}$/.test(p.artifactHash)&&/^[a-f0-9]{64}$/.test(p.reviewHash)&&p.branch==="codex/spec-sync/"+id&&
 (p.headSha===undefined||/^[a-f0-9]{40}$/.test(p.headSha))&&(p.prNumber===undefined||!!p.headSha&&Number.isSafeInteger(p.prNumber)&&p.prNumber>0);
}
const states: RequirementState[] = ["IDEA","PROPOSED","ACCEPTED_REQUIREMENT","SPEC_SYNCED","SUPERSEDED","WITHDRAWN"];

// A lexical hint proposes work; it is never permission or proof of semantic equivalence.
export function extractRequirementInput(text: string): RequirementInput | null {
 const value=text.trim();
 if (/^(?:仕様として追加|正式要件として採用|adopt requirement)[:：]\s*[^\n]+$/i.test(value) && !/[?？「」『』`]|(?:例えば|例として|もし|と仮定)/.test(value)) {
  return {decision:"accept",statement:value.replace(/^[^:：]+[:：]\s*/,""),canonicalIds:[]};
 }
 if (/(?:仕様|機能|requirement|feature)/i.test(value)) return {decision: /[?？]|例えば|例として|もし|たとえば|example/i.test(value)?"idea":"propose",statement:value,canonicalIds:[]};
 return null;
}
export function parseRequirementInput(value: unknown, text: string): RequirementInput | null {
 if(value===undefined)return extractRequirementInput(text);
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("invalid requirement decision");
 const r=value as Record<string,unknown>;
 if(Object.keys(r).some(k=>!["decision","statement","canonicalIds","supersedes"].includes(k)))throw Error("untrusted requirement field");
 if(typeof r.decision !== "string" || !["idea","propose","accept","withdraw"].includes(r.decision))throw Error("invalid requirement decision");
 if(typeof r.statement!=="string"||!r.statement.trim()||Buffer.byteLength(r.statement)>8000)throw Error("bounded requirement statement required");
 const ids=r.canonicalIds??[];
 if(!Array.isArray(ids)||ids.length>8||ids.some(id=>typeof id!=="string"||!/^[-A-Z]+-\d{3}$/.test(id))||new Set(ids).size!==ids.length)throw Error("invalid canonical IDs");
 if(r.supersedes!==undefined&&(typeof r.supersedes!=="string"||!/^owner-intake-[a-f0-9]{32}$/.test(r.supersedes)))throw Error("invalid previous requirement ID");
 if(r.decision==="withdraw"&&!r.supersedes)throw Error("withdrawal requires a previous decision");
 return {decision:r.decision as RequirementDecision,statement:r.statement.trim(),canonicalIds:[...ids] as string[],...(r.supersedes?{supersedes:r.supersedes as string}:{})};
}
function terms(value:string): Set<string> {
 const parts=semanticTerms(value).match(/[a-z0-9_-]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)??[];
 return new Set(parts.flatMap(p=>/^[a-z0-9]/.test(p)?[p]:Array.from({length:Math.max(0,p.length-1)},(_,i)=>p.slice(i,i+2))));
}
export function matchRequirementCandidates(input: RequirementInput, rows: CanonicalRequirement[]): RequirementMatch[] {
 for(const id of input.canonicalIds)if(!rows.some(r=>r.id===id))throw Error("unknown canonical ID: "+id);
 const query=terms(input.statement);
 return rows.map(r=>{const explicit=input.canonicalIds.includes(r.id),tokens=terms(r.title+" "+r.description);const common=[...query].filter(t=>tokens.has(t)).length;return{id:r.id,score:explicit?1:common/Math.max(1,query.size,tokens.size),reason:explicit?"explicit_id" as const:"text_candidate" as const,fingerprint:canonicalFingerprint(r)};}).filter(m=>m.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,8);
}
export function ownerRequirementRecords(active: unknown[]): OwnerRequirementRecord[] {
 const found=active.filter(v=>!!v&&typeof v==="object"&&(v as {kind?:unknown}).kind===OWNER_REQUIREMENTS_KIND) as Envelope[];
 const valid=(r:OwnerRequirementRecord)=>r&&/^owner-intake-[a-f0-9]{32}$/.test(r.id)&&states.includes(r.state)&&(r.goalId===null||typeof r.goalId==="string"&&r.goalId.length>0)&&typeof r.statement==="string"&&r.statement.length>0&&/^[a-f0-9]{64}$/.test(r.requestHash)&&/^[a-f0-9]{64}$/.test(r.keyDigest)&&r.source?.boundary==="broker_owner_auth"&&r.source.textSha256===sha256(r.statement)&&Number.isFinite(Date.parse(r.source.recordedAt))&&Array.isArray(r.canonicalIds)&&Array.isArray(r.matches)&&Array.isArray(r.history)&&r.history.length>0&&Array.isArray(r.supersedes)&&Array.isArray(r.supersededBy);
 if(found.length>1||found.some(v=>v.version!==1||!Array.isArray(v.records)||v.records.length>500||v.records.some(r=>!valid(r))||new Set(v.records.map(r=>r.id)).size!==v.records.length))throw Error("owner requirement state corrupt");
 const records=found[0]?.records??[];
 const byId=new Map(records.map(r=>[r.id,r]));
 for(const r of records){
  if(r.conversation&&(!/^[a-f0-9]{64}$/.test(r.conversation.inputHash)||!/^[a-f0-9]{64}$/.test(r.conversation.contextHash)||!Array.isArray(r.conversation.referenceIds)||r.conversation.referenceIds.some(id=>!byId.has(id)||byId.get(id)?.goalId!==r.goalId)))throw Error("owner conversation provenance corrupt");
  if(r.publication&&!validPublication(r.publication,r.id))throw Error("owner requirement publication corrupt");
  if(r.history.at(-1)?.state!==r.state||r.history.some(h=>!states.includes(h.state)||!Number.isFinite(Date.parse(h.at))||typeof h.reason!=="string"))throw Error("owner requirement lifecycle corrupt");
  if(r.state==="SUPERSEDED"&&!r.supersededBy.length||r.state!=="SUPERSEDED"&&r.supersededBy.length)throw Error("owner requirement successor missing");
  if(r.state==="WITHDRAWN"&&!r.history.some(h=>h.reason==="owner_withdrawal_pending_canonical_sync"))throw Error("owner requirement withdrawal provenance missing");
  for(const old of r.supersedes)if(!byId.get(old)?.supersededBy.includes(r.id)||byId.get(old)?.goalId!==r.goalId)throw Error("owner requirement previous link corrupt");
  for(const next of r.supersededBy)if(!byId.get(next)?.supersedes.includes(r.id))throw Error("owner requirement successor link corrupt");
 }
 const visiting=new Set<string>(),done=new Set<string>();
 const visit=(id:string)=>{if(visiting.has(id))throw Error("owner requirement history cycle");if(done.has(id))return;visiting.add(id);for(const next of byId.get(id)?.supersededBy??[])visit(next);visiting.delete(id);done.add(id);};
 for(const id of byId.keys())visit(id);
 return structuredClone(records);
}
export function pendingRequirementBlockers(active: unknown[], goalId: string): string[] {
 try{return ownerRequirementRecords(active).filter(r=>r.state==="ACCEPTED_REQUIREMENT"&&(r.goalId===goalId||r.goalId===null)).map(r=>"spec_sync_pending:"+r.id);}catch{return ["spec_sync_state_invalid"];}
}

/** Called only after the existing owner authentication boundary. Neither a model nor
 * a sourceContext flag is an authority. Records never authorize execution or merge. */
export class OwnerRequirementIntake {
 private readonly compass: CompassStore;
 constructor(compass: CompassStore){this.compass=compass;}
 list(){return ownerRequirementRecords(this.compass.getState().active);}
 recordPublication(id:string,plan:RequirementPublication):void {
  if(!validPublication(plan,id))throw Error("invalid publication plan");
  this.compass.updateActive(active=>{
   const records=ownerRequirementRecords(active),r=records.find(v=>v.id===id);
   if(!r||r.state!=="ACCEPTED_REQUIREMENT")throw Error("receipt_changed");
   if(r.publication&&Object.entries(plan).some(([k,v])=>r.publication![k as keyof RequirementPublication]!==undefined&&r.publication![k as keyof RequirementPublication]!==v))throw Error("publication_plan_conflict");
   r.publication=structuredClone({...r.publication,...plan});
   return [...active.filter(v=>!(v&&typeof v==="object"&&(v as {kind?:unknown}).kind===OWNER_REQUIREMENTS_KIND)),{kind:OWNER_REQUIREMENTS_KIND,version:1,records}];
  });
 }
 bindGoal(id:string,goalId:string|null):OwnerRequirementRecord {
  let result:OwnerRequirementRecord|undefined;
  this.compass.updateActive(active=>{
   const records=ownerRequirementRecords(active),record=records.find(r=>r.id===id);
   if(!record)throw Error("owner receipt missing before Goal binding");
   if(record.goalId!==null&&record.goalId!==goalId)throw Error("owner receipt already bound to another Goal");
   if(record.goalId===null&&goalId!==null){
    if(record.supersedes.length||record.supersededBy.length)throw Error("cannot rebind an existing requirement chain");
    for(const ref of record.conversation?.referenceIds??[]){const source=records.find(r=>r.id===ref);if(!source||source.goalId!==null)throw Error("cannot rebind conversation source");source.goalId=goalId;}
    record.goalId=goalId;
   }
   result=record;
   return [...active.filter(v=>!(v&&typeof v==="object"&&(v as {kind?:unknown}).kind===OWNER_REQUIREMENTS_KIND)),{kind:OWNER_REQUIREMENTS_KIND,version:1,records}];
  });
  return structuredClone(result!);
 }
 prepareConversation(text:string,key:string|undefined,context:{goalId:string|null;referenceId?:string}):PreparedRequirement {
  if(!text.trim()||Buffer.byteLength(text)>16000||(key!==undefined&&(!key.trim()||key.length>200)))throw Error("bounded owner work input required");
  if(context.referenceId!==undefined&&!/^owner-intake-[a-f0-9]{32}$/.test(context.referenceId))throw Error("invalid conversation reference");
  const inputHash=sha256(text.trim()),contextHash=sha256(JSON.stringify({referenceId:context.referenceId??null})),requestKey=key??randomUUID();
  const prior=this.list().find(r=>r.keyDigest===sha256(requestKey.trim()));
  if(prior){
   if(prior.goalId!==context.goalId||prior.conversation?.inputHash!==inputHash||prior.conversation.contextHash!==contextHash)throw Error("owner requirement idempotency conflict");
   const initial=prior.history[0].reason;
   const decision:RequirementDecision=initial==="owner_withdrawal_pending_canonical_sync"?"withdraw":initial==="authenticated_owner_accept"?"accept":initial==="authenticated_owner_idea"?"idea":"propose";
   return {input:{decision,statement:prior.statement,canonicalIds:prior.canonicalIds,...(prior.supersedes[0]?{supersedes:prior.supersedes[0]}:{})},requestHash:prior.requestHash,keyDigest:prior.keyDigest,conversation:prior.conversation};
  }
  const resolution=resolveOwnerConversation(text,{...context,records:this.list()});
  const prepared=this.prepare(text,requestKey,resolution.input??undefined);
  prepared.input=resolution.input;
  prepared.resolution=resolution;
  prepared.conversation={inputHash,contextHash,resolution:resolution.resolution,confidence:resolution.confidence,referenceIds:resolution.referenceIds,message:resolution.message};
  return prepared;
 }
 prepare(text:string,key:string|undefined,raw:unknown):PreparedRequirement {
  if(!text.trim()||Buffer.byteLength(text)>16000||(key!==undefined&&(!key.trim()||key.length>200)))throw Error("bounded owner work input required");
  const input=parseRequirementInput(raw,text);
  const requestHash=sha256(JSON.stringify({text:text.trim(),requirement:input}));
  const keyDigest=sha256(key?.trim()||requestHash);
  const existing=this.list().find(r=>r.keyDigest===keyDigest);
  if(existing&&existing.requestHash!==requestHash)throw Error("owner requirement idempotency conflict");
  return {input,requestHash,keyDigest};
 }
 capture(prepared: ReturnType<OwnerRequirementIntake["prepare"]>, goalId:string|null, rows:CanonicalRequirement[]): OwnerRequirementRecord|null {
  const {input,requestHash,keyDigest}=prepared;if(!input)return null;
  const matches=matchRequirementCandidates(input,rows);
  let result:OwnerRequirementRecord|undefined;
  this.compass.updateActive(active=>{
   const records=ownerRequirementRecords(active);const prior=records.find(r=>r.keyDigest===keyDigest);
   if(prior){if(prior.requestHash!==requestHash)throw Error("owner requirement idempotency conflict");result=prior;return active;}
   if(records.length>=500)throw Error("owner requirement history capacity reached; archive with reviewed preservation before more intake");
   const previous=input.supersedes?records.find(r=>r.id===input.supersedes):undefined;
   if(input.supersedes&&(!previous||previous.goalId!==goalId||["WITHDRAWN","SUPERSEDED"].includes(previous.state)))throw Error("previous decision is absent, belongs to another Goal, or already replaced");
   if(previous&&!previous.history.some(h=>["authenticated_owner_accept","owner_withdrawal_pending_canonical_sync"].includes(h.reason)))throw Error("adopted previous decision required; adopt a proposal as a separate receipt");
   if(previous&&!["accept","withdraw"].includes(input.decision))throw Error("a proposal cannot retire an adopted requirement");
   const at=new Date().toISOString(),id="owner-intake-"+sha256(keyDigest).slice(0,32);
   const state:RequirementState=input.decision==="accept"||input.decision==="withdraw"?"ACCEPTED_REQUIREMENT":input.decision==="idea"?"IDEA":"PROPOSED";
   result={id,goalId,state,statement:input.statement,requestHash,keyDigest,source:{boundary:"broker_owner_auth",textSha256:sha256(input.statement),recordedAt:at},canonicalIds:input.canonicalIds,matches,reviewRequired:true,supersedes:previous?[previous.id]:[],supersededBy:[],history:[{state,at,reason:input.decision==="withdraw"?"owner_withdrawal_pending_canonical_sync":"authenticated_owner_"+input.decision}]};
   if(prepared.conversation)result.conversation=structuredClone(prepared.conversation);
   if(previous){previous.state="SUPERSEDED";previous.supersededBy.push(id);previous.history.push({state:"SUPERSEDED",at,reason:id});}
   records.push(result);
   return [...active.filter(v=>!(v&&typeof v==="object"&&(v as {kind?:unknown}).kind===OWNER_REQUIREMENTS_KIND)),{kind:OWNER_REQUIREMENTS_KIND,version:1,records}];
  });
  return structuredClone(result!);
 }
}
