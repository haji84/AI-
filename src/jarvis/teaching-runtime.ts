import { teachingStore } from "./teaching-store.ts";
import { replayTeaching, selectVariant, profileKey, type Observation, type TeachingAdapter } from "./teaching.ts";
import { demonstratedStep } from "./teaching-observation.ts";
import type { JarvisRemoteAssistSessionManager } from "./remote-assist.ts";
type FetchGateway=(path:string,init?:RequestInit)=>Promise<Response>;
const actionLocks=new Set<string>();
export function teachingAdapter(serial:string,sessionId:string,sessions:JarvisRemoteAssistSessionManager,fetchGateway:FetchGateway):TeachingAdapter {
 const authorize=()=>{const s=sessions.requireActive(sessionId,serial);if(s.capability==='VIEW_ONLY')throw Error('This device is view-only');};
 const call=async(path:string,data:Record<string,unknown>)=>{authorize();const r=await fetchGateway(path,{method:'POST',body:JSON.stringify({serial,...data}),signal:AbortSignal.timeout(35000)});const body=await r.json();if(!r.ok)throw Error(body.message||'Device operation failed');return body;};
 return {authorize,observe:()=>call('/api/remote/teach-observe',{}) as Promise<Observation>,execute:async(action,observation,url)=>{sessions.recordAudit('action.forwarded',sessionId,serial,{action:'teaching-input',outcome:'starting'});await call('/api/remote/teach-input',{step:action,expectedScreen:observation.signature,expectedProfile:profileKey(observation.profile),...(url?{url}:{})});sessions.recordAudit('action.forwarded',sessionId,serial,{action:'teaching-input',outcome:'ok'});}};
}
export function stopTeachingSession(sessionId:string){const v=teachingStore().recording(sessionId);if(v)teachingStore().cancel(v.id);}
export async function teachingCommand(payload:Record<string,unknown>,sessions:JarvisRemoteAssistSessionManager,gateway:FetchGateway){
 const sessionId=String(payload.sessionId||''),serial=String(payload.serial||'');const adapter=teachingAdapter(serial,sessionId,sessions,gateway);adapter.authorize();const store=teachingStore();
 if(actionLocks.has(serial))throw Error('Teaching device busy');actionLocks.add(serial);
 try{
  if(payload.action==='teach-start'){for(const old of store.list().variants.filter(v=>v.status==='RECORDING'&&v.profile.deviceId===serial)){try{sessions.requireActive(old.sessionId!,serial);}catch{store.cancel(old.id);}}const observed=await adapter.observe();return {variant:store.start({goal:payload.goal,scope:payload.scope,profile:observed.profile,sessionId})};}
  if(payload.action==='teach-finish'){const v=store.recording(sessionId);if(!v)throw Error('No active demonstration');return {variant:store.finish(v.id,payload.completion,(await adapter.observe()).signature)};}
  if(payload.action==='teach-cancel'){const v=store.recording(sessionId);if(!v)throw Error('No active demonstration');store.cancel(v.id);return {ok:true};}
  if(payload.action==='teach-verify'||payload.action==='teach-execute'){
   if(store.recording(sessionId))throw Error('Finish demonstration before replay');
   const requested=store.get(String(payload.variantId||''));
   const selected=payload.action==='teach-execute'?selectVariant(store.list().variants,requested.goal,(await adapter.observe()).profile):requested;
   if(!selected)throw Error('No compatible device procedure');
   const run=await replayTeaching(store,selected.id,adapter,payload.action==='teach-verify'?'verify':'execute',typeof payload.url==='string'?payload.url:undefined);
   return {run};
  }
  throw Error('Unknown teaching command');
 }finally{actionLocks.delete(serial);}
}
export async function beforeTeachingInput(payload:Record<string,unknown>,sessions:JarvisRemoteAssistSessionManager,gateway:FetchGateway){
 const serial=String(payload.serial||''),sessionId=String(payload.sessionId||'');
 if(!['tap','swipe','text','keyevent','open-url'].includes(String(payload.action)))return null;
 if(actionLocks.has(serial))throw Error('Teaching device busy');
 if(teachingStore().list().variants.some(v=>v.status==='RECORDING'&&v.profile.deviceId===serial&&v.sessionId!==sessionId))throw Error('This device is recording in another session');
 const variant=teachingStore().recording(sessionId);if(!variant)return null;
 if(variant.steps.length>=50)throw Error('Teaching step limit reached');
 actionLocks.add(serial);const adapter=teachingAdapter(serial,sessionId,sessions,gateway);
 try {const before=await adapter.observe();return {finish:async(ok:boolean)=>{try{if(ok){const after=await adapter.observe();teachingStore().append(variant.id,demonstratedStep(payload,before,after));}else teachingStore().cancel(variant.id);}catch(error){if(teachingStore().recording(sessionId))teachingStore().cancel(variant.id);throw error;}finally{actionLocks.delete(serial);}},abort:()=>{if(teachingStore().recording(sessionId))teachingStore().cancel(variant.id);},release:()=>actionLocks.delete(serial)};}
 catch(error){actionLocks.delete(serial);throw error;}
}


