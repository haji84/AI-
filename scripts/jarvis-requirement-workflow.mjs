import {createHash} from 'node:crypto';
import {prepareSpecificationProposal,verifyCanonicalReceipt} from './jarvis-owner-spec-sync.mjs';
import {requirementFingerprint} from './jarvis-requirement-audit.mjs';
import {protectedRequirementReasons} from '../src/orchestrator/owner-conversation.ts';
export function requirementWorkflow(records,bundle,root,publishAvailable){
 const adopted=new Set(records.filter(r=>r.conversation?.resolution==='saved_reference').flatMap(r=>r.conversation.referenceIds));
 return {publishAvailable,records:records.slice(-100).reverse().map(r=>{
  const gate=protectedRequirementReasons(r.statement);
  const verification=verifyCanonicalReceipt(r,bundle,root),synced=['ACCEPTED_REQUIREMENT','SPEC_SYNCED','WITHDRAWN'].includes(r.state)&&verification.ok;
  const displayState=['SUPERSEDED','WITHDRAWN'].includes(r.state)?r.state:synced?verification.state:gate.length?'HUMAN_GATE':r.publication?.prNumber?'REVIEW_PENDING':r.state;
  return {...r,displayState,adopted:adopted.has(r.id),withdrawalPending:r.history.some(h=>h.reason==='owner_withdrawal_pending_canonical_sync'),gateReasons:gate,canonicalSynced:synced,publicationUrl:r.publication?.prNumber?'https://github.com/haji84/AI-/pull/'+r.publication.prNumber:null};
 }),requirements:bundle.matrix.requirements.map(r=>({id:r.id,title:r.title,phase:r.phase,fingerprint:requirementFingerprint(r)}))};
}
export function prepareOwnerPreview(record,bundle,choice,root,history){
 if(!choice||typeof choice!=='object'||Array.isArray(choice)||Object.keys(choice).some(k=>!['mode','id'].includes(k))||!['existing','new','history'].includes(choice.mode))throw Error('invalid requirement choice');
 const previousBindings=new Map(),visited=new Set();
 const visit=id=>{if(visited.has(id))return;visited.add(id);const d=bundle.decisions.decisions.find(v=>v.id===id);for(const b of d?.canonical??[]){const row=bundle.matrix.requirements.find(r=>r.id===b.id);if(row)previousBindings.set(row.id,{id:row.id,baseFingerprint:requirementFingerprint(row)});}for(const old of history.find(r=>r.id===id)?.supersedes??[])visit(old);};
 for(const old of record.supersedes)visit(old);
 let review;
 if(choice.mode==='new'){
  if(choice.id!==undefined)throw Error('invalid new requirement choice');
  review={sourceRef:'https://github.com/haji84/AI-/issues/681',bindings:[],newRequirement:{title:record.statement.replace(/\s+/g,' ').slice(0,120),phase:'P7',baseInventorySha256:createHash('sha256').update(JSON.stringify(bundle.inventory)).digest('hex')}};
 }else if(choice.mode==='history'){
  if(choice.id!==undefined||!record.history.some(h=>h.reason==='owner_withdrawal_pending_canonical_sync'))throw Error('invalid withdrawal choice');
  review={sourceRef:'https://github.com/haji84/AI-/issues/681',bindings:[...previousBindings.values()]};
 }else{
  const row=bundle.matrix.requirements.find(r=>r.id===choice.id);
  if(!row)throw Error('invalid existing requirement choice');
  review={sourceRef:'https://github.com/haji84/AI-/issues/681',bindings:[{id:row.id,baseFingerprint:requirementFingerprint(row)}]};
  // Corrections must reconcile every previous binding, not silently omit one.
  for(const binding of previousBindings.values())if(!review.bindings.some(b=>b.id===binding.id))review.bindings.push(binding);
 }
 const proposal=prepareSpecificationProposal(record,bundle,review,root,history);
 const decision=proposal.bundle.decisions.decisions.find(d=>d.id===record.id);
 return {...proposal,review,requirementIds:decision.canonical.map(b=>b.id),summary:record.statement};
}
