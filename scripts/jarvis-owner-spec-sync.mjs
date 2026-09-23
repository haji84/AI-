import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateOwnerDecisions,requirementFingerprint,surfaceFingerprint} from './jarvis-requirement-audit.mjs';
import {ownerRequirementRecords,OWNER_REQUIREMENTS_KIND} from '../src/orchestrator/owner-requirement-intake.ts';

const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const paths=['docs/JARVIS_PRODUCT_SPEC.md','docs/jarvis-requirements.json','docs/jarvis-owner-decisions.json'];
export function loadCanonicalBundle(root){
 const texts=paths.map(p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,''));
 return {ledger:texts[0],matrix:JSON.parse(texts[1]),decisions:JSON.parse(texts[2])};
}
function validate(bundle,root){
 const errors=validateOwnerDecisions(bundle.decisions,bundle.matrix,bundle.ledger,root);
 if(errors.length)throw Error('canonical validation failed: '+errors.slice(0,5).join('; '));
}
function receiptMatches(record,d){
 return d?.runtime_receipt?.id===record.id&&d.runtime_receipt.request_hash===record.requestHash&&d.runtime_receipt.goal_id===record.goalId&&d.source?.kind==='owner_instruction'&&d.source?.decision==='accepted'&&d.source?.excerpt===record.statement&&d.source?.text_sha256===record.source.textSha256&&digest(record.statement)===record.source.textSha256&&d.runtime_receipt.boundary==='broker_owner_auth';
}
export function verifyCanonicalReceipt(record,bundle,root){
 try{
  validate(bundle,root);
  const d=bundle.decisions.decisions.find(d=>d.id===record.id);
  if(!receiptMatches(record,d)||JSON.stringify(d.supersedes)!==JSON.stringify(record.supersedes)||!['SPEC_SYNCED','IMPLEMENTED','VERIFIED','WITHDRAWN'].includes(d.state))return {ok:false,reason:'exact_owner_receipt_not_synced'};
  if((d.state==='WITHDRAWN')!==record.history.some(h=>h.reason==='owner_withdrawal_pending_canonical_sync'))return {ok:false,reason:'withdrawal_mismatch'};
  return {ok:true,canonicalSha256:digest(json(bundle)),decisionId:d.id};
 }catch{return {ok:false,reason:'canonical_validation_failed'};}
}

function canonicalDecision(record,sourceRef,canonical,state){
 return {id:record.id,state,source:{kind:'owner_instruction',decision:'accepted',author:'haji84',ref:sourceRef,excerpt:record.statement,text_sha256:record.source.textSha256,recorded_at:record.source.recordedAt},runtime_receipt:{id:record.id,request_hash:record.requestHash,goal_id:record.goalId,boundary:record.source.boundary},protected_changes:[],canonical,supersedes:[...record.supersedes],superseded_by:state==='SUPERSEDED'?[...record.supersededBy]:[],next_action:'Review semantic conflict and Human Gate scope before merge; implementation and required evidence remain open.'};
}

/** A reviewable proposal only. Semantic selection is an explicit bounded Work/Codex
 * handoff; similarity does not establish equivalence or execution authority. */
export function prepareSpecificationProposal(record,bundle,review,root,history=[]){
 validate(bundle,root);
 if(record?.state!=='ACCEPTED_REQUIREMENT'||record.source?.boundary!=='broker_owner_auth'||digest(record.statement)!==record.source.textSha256)throw Error('adopted owner receipt required');
 if(!/^https:\/\/github\.com\/haji84\/AI-\/issues\/\d+$/.test(review?.sourceRef??''))throw Error('repository issue source required');
 const previous=[];
 if(record.supersedes.length){
  const trusted=ownerRequirementRecords([{kind:OWNER_REQUIREMENTS_KIND,version:1,records:history}]);
  const current=trusted.find(r=>r.id===record.id);
  if(!current||JSON.stringify(current)!==JSON.stringify(record))throw Error('exact current receipt missing from authenticated history');
  const visit=r=>{for(const id of r.supersedes){const old=trusted.find(v=>v.id===id);if(!old)throw Error('previous receipt missing');if(!old.history.some(h=>['authenticated_owner_accept','owner_withdrawal_pending_canonical_sync'].includes(h.reason)))throw Error('adopted previous receipt required');visit(old);if(!previous.some(v=>v.id===old.id))previous.push(old);}};visit(current);
 }
 if(bundle.decisions.decisions.some(d=>d.id===record.id))throw Error('decision already in canonical history; reconcile instead of duplicating');
 if(!Array.isArray(review.bindings)||!review.bindings.length||review.bindings.length>8||new Set(review.bindings.map(b=>b.id)).size!==review.bindings.length)throw Error('explicit reviewed bindings required');
 const next=globalThis.structuredClone(bundle);
 const withdrawn=record.history.some(h=>h.reason==='owner_withdrawal_pending_canonical_sync');
 const bindingIds=new Set(review.bindings.map(b=>b.id));
 for(const old of previous){
  const canonical=next.decisions.decisions.find(d=>d.id===old.id);
  if(canonical&&!receiptMatches(old,canonical))throw Error('previous canonical receipt conflict');
  if(canonical?.canonical?.some(link=>!bindingIds.has(link.id)))throw Error('review must include every previous canonical binding');
 }

 for(const binding of review.bindings){
  const row=next.matrix.requirements.find(r=>r.id===binding.id);
  if(!row)throw Error('new canonical requirement needs inventory review; never silently attach to an unrelated ID');
  if(row.status==='VERIFIED'||row.status==='PLATFORM_LIMITED')throw Error('verified requirement needs evidence reassessment before amendment');
  if(binding.baseFingerprint!==requirementFingerprint(row))throw Error('canonical base conflict: '+binding.id);
  for(const old of previous){
   const canonical=next.decisions.decisions.find(d=>d.id===old.id);
   const marker='\n\nOwner decision '+old.id+': '+old.statement;
   if(row.description.includes(marker))row.description=row.description.replace(marker,'');
   else if(!['SUPERSEDED','WITHDRAWN'].includes(canonical?.state)&&canonical?.canonical?.some(b=>b.id===row.id))throw Error('previous canonical text changed; explicit conflict review required');
  }
  if(!withdrawn)row.description+='\n\nOwner decision '+record.id+': '+record.statement;
  row.source_decisions=[...new Set([...(row.source_decisions??[]),record.id])];
 }
 for(const old of previous){
  let d=next.decisions.decisions.find(v=>v.id===old.id);
  if(!d){d=canonicalDecision(old,review.sourceRef,[],'SUPERSEDED');next.decisions.decisions.push(d);}
  d.state='SUPERSEDED';d.superseded_by=[...old.supersededBy];
 }
 // Existing adopted sources remain, now associated with the amended definition.
 for(const d of next.decisions.decisions)for(const link of d.canonical??[]){const row=next.matrix.requirements.find(r=>r.id===link.id);if(row)link.fingerprint=requirementFingerprint(row);}
 next.decisions.decisions.push(canonicalDecision(record,review.sourceRef,review.bindings.map(b=>{const row=next.matrix.requirements.find(r=>r.id===b.id);return{id:row.id,fingerprint:requirementFingerprint(row)};}),withdrawn?'WITHDRAWN':'SPEC_SYNCED'));
 let index=0;
 next.ledger=next.ledger.replace(/```json\r?\n[\s\S]*?\r?\n```/g,()=> '```json\n'+JSON.stringify(next.matrix.requirements[index++],null,2)+'\n```');
 validate(next,root);
 const contents=[next.ledger,json(next.matrix),json(next.decisions)],originals=[bundle.ledger,json(bundle.matrix),json(bundle.decisions)];
 return {kind:'specification_review_proposal',decisionId:record.id,reviewRequired:true,autoMerge:false,productionAuthorized:false,semanticAuthority:'explicit_work_codex_review_required',files:paths.map((p,i)=>({path:p,baseSha256:surfaceFingerprint(Buffer.from(originals[i])),content:contents[i]})),bundle:next};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.length!==1||args[0]!=='--check')throw Error('Only --check is supported; proposals are produced through authenticated intake / bounded review, never automatic main mutation');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');validate(loadCanonicalBundle(root),root);console.log(JSON.stringify({status:'PASS',authority:'reviewed_repository_only',physical_claim:false}));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
