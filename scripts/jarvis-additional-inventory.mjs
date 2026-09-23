import fs from 'node:fs';
import path from 'node:path';
export const ADDITIONAL_EVIDENCE=Object.freeze(['CODE','UNIT','INTEGRATION','SECURITY','PHYSICAL','RECOVERY']);
export function loadAdditionalInventory(root){
 const p=path.join(root,'docs/jarvis-additional-requirements.json');
 return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')):{schema_version:1,allocations:[]};
}
export function validateAdditionalInventory(inventory){
 const errors=[];
 if(inventory?.schema_version!==1||!Array.isArray(inventory.allocations)||inventory.allocations.length>999)return ['Invalid additional requirement inventory'];
 const decisions=new Set();
 inventory.allocations.forEach((a,i)=>{
  if(a?.id!=='OWN-'+String(i+1).padStart(3,'0')||!/^owner-intake-[a-f0-9]{32}$/.test(a?.decision_id??'')||decisions.has(a.decision_id)||!Number.isFinite(Date.parse(a.created_at)))errors.push('Additional requirement allocation sequence/provenance invalid');
  decisions.add(a?.decision_id);
  if(JSON.stringify(a?.required_evidence)!==JSON.stringify(ADDITIONAL_EVIDENCE))errors.push('Additional requirement evidence floor changed');
 });
 return errors;
}
export function allocateAdditionalRequirement(inventory,record){
 const errors=validateAdditionalInventory(inventory);if(errors.length)throw Error(errors.join('; '));
 if(inventory.allocations.length>=999||inventory.allocations.some(a=>a.decision_id===record.id))throw Error('additional allocation conflict or capacity');
 const a={id:'OWN-'+String(inventory.allocations.length+1).padStart(3,'0'),decision_id:record.id,created_at:record.source.recordedAt,required_evidence:[...ADDITIONAL_EVIDENCE]};
 inventory.allocations.push(a);return a;
}
