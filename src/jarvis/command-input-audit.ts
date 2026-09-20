import { createHash } from 'node:crypto';
import { InputRecoveryEngine } from './input-recovery.ts';
import type { AttachmentDescriptor } from '../app/attachment-storage.ts';
/** Intake metadata is not evidence that document contents have been read. */
export function auditCommandAttachments(attachments:AttachmentDescriptor[]) {
 if(!Array.isArray(attachments)||attachments.length>20)throw new Error('Invalid attachment intake');
 const documents=attachments.map((a,index)=>{
  if(!a||typeof a.name!=='string'||!a.name.trim()||a.name.length>180||typeof a.type!=='string'||a.type.length>160||!Number.isSafeInteger(a.size)||a.size<1)throw new Error('Invalid attachment descriptor');
  return {id:`attachment-${index+1}`,name:a.name,content:{},declaredRole:'unknown' as const};
 });
 const engine=new InputRecoveryEngine();
 const audit=engine.auditInputSet([],documents);
 const digest=createHash('sha256').update(JSON.stringify(attachments.map(a=>({name:a.name,type:a.type,size:a.size})))).digest('hex');
 return {version:1,digest,...audit,complete:false as const,requirementsState:"UNKNOWN" as const,fields:engine.recover(documents),contentState:'NOT_READ' as const,readyForExecution:false as const,
  nextAction:attachments.length?'Read scoped source contents, establish current-case provenance, recover missing inputs and verify claims before execution.':'No attached source to recover.',
  authority:'DATA_ONLY' as const};
}
