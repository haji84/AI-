// Trusted fixed two-leaf bridge. RPC is private child stdio, never a public
// endpoint. It performs no import-time I/O or permission changes.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const opaque=()=>Object.freeze(Object.create(null));
const closedError=reason=>Error(/^NATIVE_[A-Z_]{1,60}$/.test(reason)?reason:'NATIVE_OPERATION_UNAVAILABLE');
const frameLimit=256*1024;
const wireBinding=binding=>{
 const {plan:unused,...rest}=binding;
 void unused;
 return rest;
};

/** authorityCheck is trusted synchronous code, not data or an approval boolean.
 * It must throw unless the already approved source/host/run is still admitted.
 * claim(binding) is the durable consume port for the pure algorithm's gate.
 * The caller must close in finally; journals/claims are intentionally retained.
 */
export async function createCompassModeNative({scope,candidates,approvalId,sessionId,authorityCheck}={}) {
 if(process.platform!=='darwin'||typeof process.getuid!=='function'||process.getuid()<=0||
    process.getuid()!==process.geteuid()||typeof authorityCheck!=='function')throw closedError('NATIVE_CONTEXT_REJECTED');
 function authorized() {
  const value=authorityCheck();
  if(value!==undefined)throw closedError('NATIVE_AUTHORITY_VALUE_REFUSED');
  if(!scope||!Number.isSafeInteger(scope.expiresAt)||Date.now()>=scope.expiresAt)throw closedError('NATIVE_PERMIT_EXPIRED');
 }
 authorized();
 const directory=mkdtempSync(join(realpathSync(tmpdir()),'goriq-g1-native-'));
 let child,closed=false,counter=0,pending=null,buffer='',queue=Promise.resolve(),planned=null;
 const handles=new WeakMap(),byId=new Map(),receipts=new WeakMap();
 const privateEnv={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
 function cleanup() {
  try{rmSync(directory,{recursive:true,force:true});}catch{}
 }
 function rejectPending(reason) {
  if(pending){clearTimeout(pending.timer);const p=pending;pending=null;p.reject(closedError(reason));}
 }
 function abort(reason) {
  closed=true;rejectPending(reason);
  if(child){child.stdin.destroy();child.kill('SIGKILL');}
 }
 function readChunk(chunk) {
  buffer+=chunk.toString('utf8');
  if(Buffer.byteLength(buffer)>frameLimit)return abort('NATIVE_RESPONSE_BOUND');
  while(buffer.includes('\n')) {
   const position=buffer.indexOf('\n'),line=buffer.slice(0,position);buffer=buffer.slice(position+1);
   let value;
   try{value=JSON.parse(line);}catch{return abort('NATIVE_RESPONSE_INVALID');}
   if(!pending||value?.id!==pending.id||typeof value.ok!=='boolean'||
      Object.keys(value).some(key=>!['id','ok','value','reason'].includes(key)))return abort('NATIVE_RESPONSE_INVALID');
   const p=pending;pending=null;clearTimeout(p.timer);
   if(value.ok)p.resolve(value.value);else p.reject(closedError(value.reason));
  }
 }
 function exchange(payload,id) {
  return new Promise((resolve,reject)=>{
   if(closed||pending)return reject(closedError('NATIVE_SESSION_CLOSED'));
   const data=JSON.stringify(payload)+'\n';
   if(Buffer.byteLength(data)>frameLimit)return reject(closedError('NATIVE_REQUEST_BOUND'));
   pending={id,resolve,reject,timer:setTimeout(()=>abort('NATIVE_REQUEST_TIMEOUT'),20000)};
   child.stdin.write(data,error=>{if(error)abort('NATIVE_PIPE_UNAVAILABLE');});
  });
 }
 function request(cmd,fields={},check=true) {
  const task=queue.then(()=>{
   if(check)authorized();
   return exchange({id:++counter,cmd,...fields},counter);
  });
  queue=task.catch(()=>{});return task;
 }
 try {
  const metadata=lstatSync(directory);
  if(metadata.uid!==process.getuid()||(metadata.mode&0o777)!==0o700||metadata.isSymbolicLink())throw closedError('NATIVE_TEMP_REFUSED');
  const library=join(directory,'metadata.dylib');
  execFileSync('/usr/bin/cc',['-std=c11','-Wall','-Wextra','-Werror','-dynamiclib',
   join(here,'goriq-g1-compass-mode-metadata.c'),'-o',library],{
   timeout:30000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:privateEnv,
  });
  const preflight=execFileSync('/usr/bin/python3',['-I','-B',
   join(here,'..','tests','goriq-g1-compass-mode-darwin.test.py'),library],{
   timeout:30000,maxBuffer:65536,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:privateEnv,
  });
  if(preflight.trim()!=='DARWIN_METADATA_FIXTURE_PASS')throw closedError('NATIVE_METADATA_FIXTURE_REFUSED');
  authorized();
  child=spawn('/usr/bin/python3',['-I','-B',join(here,'goriq-g1-compass-mode-native.py'),library],{
   env:privateEnv,stdio:['pipe','pipe','pipe'],shell:false,
  });
  child.stdout.on('data',readChunk);
  child.stderr.on('data',()=>abort('NATIVE_STDERR_REFUSED'));
  child.on('error',()=>abort('NATIVE_PROCESS_UNAVAILABLE'));
  child.on('exit',()=>{closed=true;rejectPending('NATIVE_PROCESS_EXITED');cleanup();});
  await exchange({scope,candidates,approvalId,sessionId},0);
 }catch {
  abort('NATIVE_START_REFUSED');cleanup();throw closedError('NATIVE_START_REFUSED');
 }
 const lifetime=setTimeout(()=>abort('NATIVE_SESSION_TIMEOUT'),Math.min(120000,Math.max(1,scope.expiresAt-Date.now())));
 lifetime.unref();
 const getId=handle=>{
  const value=handles.get(handle);
  if(!value)throw closedError('NATIVE_HANDLE_REFUSED');
  return value;
 };
 const ops=Object.freeze({
  async capture(label) {
   const result=await request('capture',{label});
   if(!result||typeof result.id!=='string'||!['1','2'].includes(result.id)||!result.facts)throw closedError('NATIVE_RESPONSE_INVALID');
   let handle=byId.get(result.id);
   if(!handle){handle=opaque();byId.set(result.id,handle);handles.set(handle,result.id);}
   return {handle,facts:result.facts};
  },
  inspect:handle=>request('inspect',{handle:getId(handle)}),
  async retainJournal(record) {
   const serial={...record,binding:wireBinding(record.binding)};
   if(await request('journal',{record:serial})!==true)throw closedError('NATIVE_JOURNAL_UNCONFIRMED');
   if(record.phase==='PLANNED')planned=record;
   return opaque();
  },
  async setMode(handle,expected,mode) {
   const id=getId(handle);
   if(await request('mode',{handle:id,expected,mode})!==id)throw closedError('NATIVE_MODE_OUTCOME_UNCONFIRMED');
   return handle;
  },
 });
 return Object.freeze({ops,
  journalBinding:()=>planned?.binding??null,
  async claim(binding) {
   if(!planned||binding!==planned.binding)throw closedError('NATIVE_BINDING_REFUSED');
   if(await request('claim',{binding:wireBinding(binding)})!==true)throw closedError('NATIVE_CLAIM_REFUSED');
   const receipt=opaque();receipts.set(receipt,binding);return receipt;
  },
  verifyClaim(receipt,binding) {
   authorized();
   if(closed||receipts.get(receipt)!==binding)throw closedError('NATIVE_CLAIM_REFUSED');
   return receipt;
  },
  async close() {
   clearTimeout(lifetime);
   if(!closed){try{await request('close',{},false);}catch{}closed=true;child.stdin.end();child.kill('SIGTERM');}
   cleanup();
  },
 });
}
