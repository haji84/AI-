// Inert transport to the existing High-gated rotation controller. A mode is not approval.
import {createHash,createPublicKey,verify} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {dirname,resolve,join,win32,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';
import {performance} from 'node:perf_hooks';
import {inflateRawSync} from 'node:zlib';
import {validateProductionConfig} from './jarvis-production-config.mjs';
import {ROTATION_SOURCE_FILES,validateRotationScope,validateRotationResult} from './owner-code-rotation-acceptance.mjs';
import {validateRotationExerciseResult} from './owner-code-rotation-exercise.mjs';
import {fleetSnapshotSummary,compareFleetSnapshots} from './owner-code-fleet-preservation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const strings=['scopeId','ownerSid','issuedAt','expiresAt','sourceRevision','configSha256','taskSha256','nodeSha256','runtimeRevision','dbPath','attemptId'];
const prepCodes=['ROTATION_ENTRY_SCOPE_REQUIRED','ROTATION_ENTRY_CONTEXT_REQUIRED','ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED','ROTATION_ENTRY_SOURCE_REJECTED','ROTATION_ENTRY_ATTEMPT_CONSUMED','ROTATION_ENTRY_NODE_REJECTED','ROTATION_ENTRY_PREPARATION_FAILED'];
const codes=[...prepCodes,'ROTATION_ENTRY_PROTOCOL_FAILED','ROTATION_ENTRY_TIMEOUT','ROTATION_ENTRY_CHILD_UNAVAILABLE','ROTATION_ENTRY_CONTROLLER_FAILED'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=code=>{throw new Error(code);};


// Consumer-only DATA: this transformation never reads configuration, starts a
// process, or creates native/start-only authority. The owned peer must bind its
// actual input bytes/source/Owner and original private lifetime separately.
const cleanPlatformFields=['SystemRoot','ComSpec','USERPROFILE','LOCALAPPDATA','TEMP','TMP','PATH','PATHEXT','PSModulePath'];
const cleanStartupControls=new Set(["HTTPS_PROXY","HTTP_PROXY","NODE_CHANNEL_FD","NODE_CHANNEL_SERIALIZATION_MODE","NODE_CLUSTER_SCHED_POLICY","NODE_COMPILE_CACHE","NODE_COMPILE_CACHE_PORTABLE","NODE_DEBUG","NODE_DEBUG_NATIVE","NODE_DISABLE_COMPILE_CACHE","NODE_EXTRA_CA_CERTS","NODE_ICU_DATA","NODE_NO_WARNINGS","NODE_OPTIONS","NODE_PATH","NODE_PENDING_DEPRECATION","NODE_PENDING_PIPE_INSTANCES","NODE_PRESERVE_SYMLINKS","NODE_PRESERVE_SYMLINKS_MAIN","NODE_REDIRECT_WARNINGS","NODE_REPL_EXTERNAL_MODULE","NODE_REPL_HISTORY","NODE_SKIP_PLATFORM_CHECK","NODE_TEST_CONTEXT","NODE_TLS_REJECT_UNAUTHORIZED","NODE_UNIQUE_ID","NODE_USE_ENV_PROXY","NODE_USE_SYSTEM_CA","NODE_V8_COVERAGE","OPENSSL_CONF","OPENSSL_CONF_INCLUDE","OPENSSL_ENGINES","OPENSSL_MALLOC_FAILURES","OPENSSL_MALLOC_FD","OPENSSL_MALLOC_SEED","OPENSSL_MODULES","OPENSSL_WIN32_UTF8","OPENSSL_IA32CAP","SSL_CERT_DIR","SSL_CERT_FILE","WATCH_REPORT_DEPENDENCIES","NODE_DISABLE_COLORS","FORCE_COLOR","NO_COLOR","TZ","UV_THREADPOOL_SIZE","COR_ENABLE_PROFILING","COR_PROFILER","COR_PROFILER_PATH","COR_PROFILER_PATH_32","COR_PROFILER_PATH_64","COR_PROFILER_PATH_ARM64","APPDOMAIN_MANAGER_ASM","APPDOMAIN_MANAGER_TYPE","DEVPATH","COMPLUS_PROFAPI_PROFILERCOMPATIBILITYSETTING","COMPLUS_MDA","PSMODULEANALYSISCACHEPATH","PSDISABLEMODULEANALYSISCACHECLEANUP"].map(name=>name.toUpperCase()));
const cleanForbiddenFallback=new Set([...cleanStartupControls,...cleanPlatformFields.map(name=>name.toUpperCase()),'HOME','WINDIR','PSEXECUTIONPOLICYPREFERENCE','JARVIS_PRODUCTION_CONFIG','GORIQ_RUNTIME_REVISION','NODE_ENV']);
const prototypeNames=new Set(Object.getOwnPropertyNames(Object.prototype).map(name=>name.toUpperCase()));
function cutoverProjection(value,depth=0){
 if(depth>16)fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(item=>cutoverProjection(item,depth+1));
 if(!object(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');
 return Object.fromEntries(Object.keys(value).sort().map(key=>[key,cutoverProjection(value[key],depth+1)]));
}
export function deriveCutoverCleanEnvironmentData(configuration,releaseRoot,fallbackBytes,platform){
 try{
  if(!exact(platform,cleanPlatformFields)||cleanPlatformFields.some(name=>typeof platform[name]!=='string'||!platform[name]||/[\r\n\0]/.test(platform[name]))||!Array.isArray(fallbackBytes)||fallbackBytes.length!==2||fallbackBytes.some(bytes=>!(bytes instanceof Uint8Array)||bytes.byteLength>65536))fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');
  const configured=validateProductionConfig(configuration,releaseRoot),values=new Map();
  const put=(name,value,overwrite=false)=>{const folded=name.toUpperCase();if(overwrite||!values.has(folded))values.set(folded,{name,value});};
  for(const [name,value] of Object.entries(platform))put(name,value);
  put('WINDIR',platform.SystemRoot);
  for(const [name,value] of Object.entries(configured))put(name,value,true);
  for(const bytes of fallbackBytes){
   const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
   for(const rawLine of text.split(/\r?\n/)){
    const line=rawLine.trim();if(!line||line.startsWith('#'))continue;const index=line.indexOf('=');if(index<=0)continue;
    const name=line.slice(0,index).trim(),folded=name.toUpperCase();let value=line.slice(index+1).trim();
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||prototypeNames.has(folded)||cleanForbiddenFallback.has(folded)||value.includes('\0'))fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');
    if(value.startsWith('"')&&value.endsWith('"')||value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
    put(name,value);
   }
  }
  const projection=cutoverProjection(configuration);delete projection.environment.JARVIS_OWNER_SECRET;
  const environment=Object.fromEntries([...values.values()].map(({name,value})=>[name,value]));
  return frozenTree({profile:'goriq-clean-start-environment-data-v1',effectCapability:false,environment,nonOwnerProjectionSha256:hash(JSON.stringify(projection)),fallbackSha256:fallbackBytes.map(hash)});
 }catch{fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');}
}


// PURE data predicates. These do not read clocks/processes/files, discover a
// runtime, or authenticate a native clock/DB role. Genuine private producers
// and sticky original UTC/protocol state remain mandatory before any DB BIND.
const cutoverSigned64Max=9223372036854775807n,cutoverUnsigned64Max=18446744073709551615n;
function cutoverDecimal(value,max,zero=false){if(typeof value!=='string'||value.length>20||!/^(?:0|[1-9][0-9]*)$/.test(value))throw 0;const n=BigInt(value);if(n>max||(!zero&&n===0n))throw 0;return n;}
function cutoverHex(value,n=64){return typeof value==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(value);}
function cutoverPid(value){return Number.isSafeInteger(value)&&value>0&&value<=2147483647;}
function cutoverUtc(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))throw 0;
 const year=BigInt(value.slice(0,4)),month=BigInt(value.slice(5,7)),day=BigInt(value.slice(8,10)),hour=BigInt(value.slice(11,13)),minute=BigInt(value.slice(14,16)),second=BigInt(value.slice(17,19)),millisecond=BigInt(value.slice(20,23));
 const leap=year%4n===0n&&(year%100n!==0n||year%400n===0n),lengths=[31n,leap?29n:28n,31n,30n,31n,30n,31n,31n,30n,31n,30n,31n];
 if(year<1n||month<1n||month>12n||day<1n||day>lengths[month-1n]||hour>23n||minute>59n||second>59n)throw 0;
 const previousYear=year-1n;let days=365n*previousYear+previousYear/4n-previousYear/100n+previousYear/400n+day-1n;
 for(let prior=1n;prior<month;prior++)days+=lengths[prior-1n];
 return (((days*24n+hour)*60n+minute)*60n+second)*1000n+millisecond;
}
export function quantizeCutoverQpcNanoseconds(counterDecimal,frequencyDecimal){
 try{
  if(arguments.length!==2)throw 0;const counter=cutoverDecimal(counterDecimal,cutoverSigned64Max),frequency=cutoverDecimal(frequencyDecimal,cutoverSigned64Max);
  // Exact pinned libuv operation order, deliberately binary64 then truncation.
  // No endpoint/identity arithmetic uses Number outside this quantizer.
  const scaledFrequency=Number(frequency)/1000000000,result=Number(counter)/scaledFrequency;
  if(!Number.isFinite(scaledFrequency)||scaledFrequency<=0||!Number.isFinite(result)||result<0)throw 0;
  const integer=BigInt(Math.trunc(result));if(integer>cutoverUnsigned64Max)throw 0;return String(integer);
 }catch{fail('ROTATION_CUTOVER_QPC_DATA_REJECTED');}
}
const qpcBindingFields=['sourceRevision','originalGrantSha256','attemptId','workflowRunId','officialJobId','parentPid','parentCreationTicks','nodePid','nodeCreationTicks','ownerSidSha256','sessionId','nodeImageSha256','nativeMjsSha256','nativePsSha256'];
function cutoverQpcBinding(value){
 if(!exact(value,qpcBindingFields)||!cutoverHex(value.sourceRevision,40)||!cutoverPid(value.parentPid)||!cutoverPid(value.nodePid)||value.parentPid===value.nodePid||!Number.isSafeInteger(value.sessionId)||value.sessionId<0||value.nodeImageSha256!==cutoverNode.nodeSha256||typeof value.attemptId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.attemptId))throw 0;
 for(const k of ['originalGrantSha256','ownerSidSha256','nativeMjsSha256','nativePsSha256'])if(!cutoverHex(value[k]))throw 0;
 for(const k of ['workflowRunId','officialJobId'])cutoverDecimal(value[k],cutoverUnsigned64Max);
 if(cutoverDecimal(value.parentCreationTicks,3155378975999999999n)>cutoverDecimal(value.nodeCreationTicks,3155378975999999999n))throw 0;
}
export function validateCutoverOriginalQpcData(data,expected){
 try{
  if(arguments.length!==2||!exact(data,['profile','platform','architecture','nodeVersion','binding','frequencyQpc','stopwatchFrequency','stopwatchHighResolution','nodeHrBefore','nodeHrAfter','qpcBefore','stopwatchSample','qpcAfter','originQpc','forwardQpc','hardQpc','hardEndUtc','originalClockState'])||!exact(expected,['binding','originQpc','frequencyQpc','originalForwardQpc','originalHardQpc','originalHardEndUtc','previousForwardQpc','previousHardQpc','previousHardEndUtc','previousNodeHrtime']))throw 0;
  if(data.profile!=='goriq-original-qpc-association-data-v1'||data.platform!=='win32'||data.architecture!=='x64'||data.nodeVersion!=='24.19.0'||data.stopwatchHighResolution!==true||data.originalClockState!=='VALID')throw 0;
  cutoverQpcBinding(data.binding);cutoverQpcBinding(expected.binding);if(qpcBindingFields.some(k=>data.binding[k]!==expected.binding[k]))throw 0;
  const freq=cutoverDecimal(expected.frequencyQpc,cutoverSigned64Max),origin=cutoverDecimal(expected.originQpc,cutoverSigned64Max),originalHard=cutoverDecimal(expected.originalHardQpc,cutoverSigned64Max),originalForward=cutoverDecimal(expected.originalForwardQpc,cutoverSigned64Max),previousHard=cutoverDecimal(expected.previousHardQpc,cutoverSigned64Max),previousForward=cutoverDecimal(expected.previousForwardQpc,cutoverSigned64Max,true),hard=cutoverDecimal(data.hardQpc,cutoverSigned64Max),forward=cutoverDecimal(data.forwardQpc,cutoverSigned64Max,true),reserve=120n*freq;
  if(data.frequencyQpc!==expected.frequencyQpc||data.stopwatchFrequency!==expected.frequencyQpc||data.originQpc!==expected.originQpc||originalHard<=origin+reserve||originalHard-origin>900n*freq||originalForward!==originalHard-reserve||previousHard>originalHard||hard>previousHard||previousForward!==(previousHard>reserve?previousHard-reserve:0n)||forward!==(hard>reserve?hard-reserve:0n)||forward>previousForward)throw 0;
  const originalUtc=cutoverUtc(expected.originalHardEndUtc),previousUtc=cutoverUtc(expected.previousHardEndUtc),hardUtc=cutoverUtc(data.hardEndUtc);if(previousUtc>originalUtc||hardUtc>previousUtc)throw 0;
  // Every advertised UTC tightening also tightens the absolute QPC cap. Ceil
  // stops early for fractional tick deltas; no Date/Number budget conversion.
  const previousUtcCap=originalHard-((originalUtc-previousUtc)*freq+999n)/1000n,currentUtcCap=originalHard-((originalUtc-hardUtc)*freq+999n)/1000n;
  if(previousHard>previousUtcCap||hard>currentUtcCap)throw 0;
  const before=cutoverDecimal(data.qpcBefore,cutoverSigned64Max),sample=cutoverDecimal(data.stopwatchSample,cutoverSigned64Max),after=cutoverDecimal(data.qpcAfter,cutoverSigned64Max),hrBefore=cutoverDecimal(data.nodeHrBefore,cutoverUnsigned64Max,true),hrAfter=cutoverDecimal(data.nodeHrAfter,cutoverUnsigned64Max,true),previousHr=cutoverDecimal(expected.previousNodeHrtime,cutoverUnsigned64Max,true);
  if(before<origin||sample<before||sample>after||after<before||hrBefore<previousHr||hrAfter<hrBefore||hrBefore>BigInt(quantizeCutoverQpcNanoseconds(data.qpcBefore,expected.frequencyQpc))||BigInt(quantizeCutoverQpcNanoseconds(data.qpcAfter,expected.frequencyQpc))>hrAfter)throw 0;
  const hardMapped=BigInt(quantizeCutoverQpcNanoseconds(data.hardQpc,expected.frequencyQpc)),forwardMapped=forward===0n?0n:BigInt(quantizeCutoverQpcNanoseconds(data.forwardQpc,expected.frequencyQpc));if(hrAfter>=hardMapped)throw 0;
  return frozenTree({profile:'goriq-original-qpc-association-data-v1',associationDataMatched:true,remainingHardNs:String(hardMapped-hrAfter),remainingForwardNs:String(forwardMapped>hrAfter?forwardMapped-hrAfter:0n),nativeAuthority:false,originalClockAuthorityVerified:false});
 }catch{fail('ROTATION_CUTOVER_QPC_DATA_REJECTED');}
}
export function validateCutoverActiveDbUseData(data,expected){
 try{
  const expectedFields=['databasePath','databaseIdentityKey','runtimePid','runtimeCreationFiletime','runtimeOwnerSidSha256','runtimeSessionId','runtimeParentPid','nodePath','brokerSourceSha256','runtimeRevision','observerPid','ownedPeerPid'];
  if(arguments.length!==2||!exact(data,['profile','registeredFiles','registeredApplications','registeredServices','resultCode','fileBefore','fileAfter','processBefore','processAfter','rmProcesses'])||!exact(expected,expectedFields)||data.profile!=='goriq-fixed-broker-db-use-data-v1'||!peerPath(expected.databasePath)||!peerPath(expected.nodePath)||typeof expected.databaseIdentityKey!=='string'||!/^[a-f0-9]{8}:[a-f0-9]{16}$/.test(expected.databaseIdentityKey))throw 0;
  if(!cutoverPid(expected.runtimePid)||!cutoverPid(expected.runtimeParentPid)||!cutoverPid(expected.observerPid)||!cutoverPid(expected.ownedPeerPid)||expected.runtimePid===expected.runtimeParentPid||new Set([expected.runtimePid,expected.observerPid,expected.ownedPeerPid]).size!==3||!Number.isSafeInteger(expected.runtimeSessionId)||expected.runtimeSessionId<0||!cutoverHex(expected.runtimeOwnerSidSha256)||!cutoverHex(expected.brokerSourceSha256)||!cutoverHex(expected.runtimeRevision,40))throw 0;
  cutoverDecimal(expected.runtimeCreationFiletime,2650467743999999999n);
  if(!Array.isArray(data.registeredFiles)||data.registeredFiles.length!==1||typeof data.registeredFiles[0]!=='string'||data.registeredFiles[0].toLowerCase()!==expected.databasePath.toLowerCase()||data.registeredApplications!==0||data.registeredServices!==0||data.resultCode!==0)throw 0;
  for(const file of [data.fileBefore,data.fileAfter])if(!exact(file,['identityKey','finalPath','links'])||file.identityKey!==expected.databaseIdentityKey||typeof file.finalPath!=='string'||file.finalPath.toLowerCase()!==expected.databasePath.toLowerCase()||file.links!==1)throw 0;
  const processFields=['pid','parentPid','creationFiletime','ownerSidSha256','sessionId','imagePath','imageSha256','brokerSourceSha256','releaseRevision','listenerAddress','listenerPort'];
  for(const row of [data.processBefore,data.processAfter])if(!exact(row,processFields)||row.pid!==expected.runtimePid||row.parentPid!==expected.runtimeParentPid||row.creationFiletime!==expected.runtimeCreationFiletime||row.ownerSidSha256!==expected.runtimeOwnerSidSha256||row.sessionId!==expected.runtimeSessionId||typeof row.imagePath!=='string'||row.imagePath.toLowerCase()!==expected.nodePath.toLowerCase()||row.imageSha256!==cutoverNode.nodeSha256||row.brokerSourceSha256!==expected.brokerSourceSha256||row.releaseRevision!==expected.runtimeRevision||row.listenerAddress!=='127.0.0.1'||row.listenerPort!==8787)throw 0;
  if(!Array.isArray(data.rmProcesses)||data.rmProcesses.length>64)throw 0;const seen=new Set();let matches=0;
  for(const row of data.rmProcesses){if(!exact(row,['pid','creationFiletime'])||!cutoverPid(row.pid)||seen.has(row.pid))throw 0;seen.add(row.pid);cutoverDecimal(row.creationFiletime,2650467743999999999n);if(row.pid===expected.runtimePid&&row.creationFiletime===expected.runtimeCreationFiletime)matches++;}
  if(matches!==1)throw 0;return frozenTree({profile:'goriq-fixed-broker-db-use-data-v1',fileUseDataMatched:true,rmProcessCount:data.rmProcesses.length,nativeAuthority:false,actualDatabaseAuthorityVerified:false});
 }catch{fail('ROTATION_CUTOVER_ACTIVE_DB_DATA_REJECTED');}
}

// PURE DATA observer: opaque core9 snapshots are already captured by the
// consumer. No filesystem/SQL/process/clock/callback is performed here. Only
// genuine private native/peer provenance can authorize a future live capture.
const preservationObservers=new WeakMap(),preservationSnapshotOwners=new WeakMap();
const preservationTransitions=Object.freeze({
 initial:{'capture-before-cutover':'captured'},
 captured:{'after-cutover':'cutover-checked','after-rollback':'restored'},
 'cutover-checked':{'before-rotation':'baseline','after-rollback':'restored'},
 baseline:{'before-commit':'checked','after-rollback':'restored'},
 checked:{'before-planned-restore':'planned','after-planned-restore':'planned-restored','after-rollback':'restored'},
 planned:{'after-planned-restore':'planned-restored'},
 restored:{},'planned-restored':{},terminal:{}
});
export function createCutoverPreservationDataObserver(){
 if(arguments.length!==0)fail('ROTATION_CUTOVER_PRESERVATION_DATA_REJECTED');
 const token=Object.freeze(Object.create(null));preservationObservers.set(token,{phase:'initial',baseline:null,summary:null,comparison:null});return token;
}
export function acceptCutoverPreservationData(token,event,snapshot){
 let record,capture=false;
 try{
  if(arguments.length!==3||!object(token)||!(record=preservationObservers.get(token))||typeof event!=='string'||!Object.hasOwn(preservationTransitions[record.phase],event))throw 0;
  if(['before-rotation','before-commit','before-planned-restore'].includes(event)&&record.comparison?.status!=='PASS')throw 0;
  capture=event==='capture-before-cutover';record.phase=preservationTransitions[record.phase][event];record.comparison=null;
  // An entered failed observation cannot preserve an older PASS, and a failed
  // first capture consumes this observer. No baseline-reset API exists.
  if(!object(snapshot)||preservationSnapshotOwners.has(snapshot))throw 0;
  const summary=fleetSnapshotSummary(snapshot);preservationSnapshotOwners.set(snapshot,token);
  if(capture){
   if(record.baseline!==null||summary.fleetCount!==38||summary.schemaProfile!=='jarvis-control-plane-sqlite-v1'||summary.pcSidecars?.profile!=='jarvis-pc-sidecars-v1'||compareFleetSnapshots(snapshot,snapshot).status!=='PASS')throw 0;
   record.baseline=snapshot;record.summary=summary;
  }else{
   if(record.baseline===null)throw 0;
   record.comparison=compareFleetSnapshots(record.baseline,snapshot);
  }
  return frozenTree({profile:'goriq-cutover-original-fleet-data-v1',event,requiredClockPhase:['after-rollback','after-planned-restore'].includes(event)?'RECOVERY':'FORWARD',accepted:capture||record.comparison.status==='PASS',summary:record.summary,comparison:record.comparison,nativeAuthority:false,effectCapability:false});
 }catch{
  if(capture&&record)record.phase='terminal';
  fail('ROTATION_CUTOVER_PRESERVATION_DATA_REJECTED');
 }
}


// Explicit NEW guarded-preservation DATA profile. The literal pure semantics
// below originate in frozen fleet197d838c and PCd0d5d9fd; these are separate
// closures and WeakMaps, not core9 runtime handles or a live capture adapter.
// Nested legacy cohortAuthorityVerified fields describe DATA equivalence only.
// capturedAtMs is caller DATA: even an unseen older valid capture proves no
// freshness. Genuine original session/clock/held DB authority is still absent.
// No filesystem, SQL, clock sampling, process, callback or native CWT is used.
const guardedPreservationData = (() => {
const pc = (() => {
const PROFILE = "jarvis-pc-sidecars-v1", MAX_BYTES = 8 * 1024 * 1024;
const ownErrors = new WeakSet();
const COVERAGE = Object.freeze({ pcTaskSidecars: true, pcObservationSidecars: true, workerPrivateKeys: false, compassHistory: false, cognitiveHistory: false, wholeR06: false, crossStoreAtomicity: false });
const STATUSES = ["queued", "waiting-dependency", "leased", "running", "waiting-connectivity", "waiting-resource", "ready-to-publish", "retrying", "completed", "failed", "cancelled"];
const TERMINAL = ["completed", "failed", "cancelled"];
const TASK_KEYS = "id idempotencyKey type payload status priority requiredCapabilities dependsOn attempts maxAttempts migrationClass pinnedNodeId waitReason executionEpoch leaseOwner leaseUntil fencingToken nextAttemptAt checkpointRef result error createdAt updatedAt history".split(" ");
const TASK_REQUIRED = "id idempotencyKey type payload status priority requiredCapabilities dependsOn attempts maxAttempts migrationClass executionEpoch createdAt updatedAt history".split(" ");
const RUNTIME = "status attempts executionEpoch leaseOwner leaseUntil fencingToken nextAttemptAt waitReason result error updatedAt history".split(" ");
const CAPSULE = "goal currentJob why workflowPosition inputs constraints decisions dependencies expectedOutput definitionOfDone verificationContract recoveryContext".split(" ");
const RESULT_KEYS = "sha256 bytes nodeId goalIssue verified issuer executionEpoch observedAt".split(" ");
const SIGNED_KEYS = "nodeId timestamp nonce method path bodySha256 signatureBase64".split(" ");
const RECEIVE_PATH = "/api/jarvis/worker/pc/observation/receive";
function fail(code) { const error = new Error(code); error.code = code; ownErrors.add(error); throw error; }
function requireValue(value, code = "PC_PAYLOAD_INVALID") { if (!value) fail(code); }
function object(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function shape(v, allowed, required = allowed) { return object(v) && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k)); }
function text(v, max = 16_384) { return typeof v === "string" && v.length > 0 && v.length <= max; }
function date(v) { return text(v, 30) && Number.isFinite(Date.parse(v)); }
function integer(v) { return Number.isSafeInteger(v) && v >= 0; }
function hex(v, n = 64) { return typeof v === "string" && new RegExp(`^[a-f0-9]{${n}}$`).test(v); }
function node(v) { return v === "macbook" || v === "zbook"; }
function hash(v) { return createHash("sha256").update(v).digest("hex"); }
function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (object(v)) return "{" + Object.keys(v).sort((a, b) => a.localeCompare(b)).map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function same(a, b) { return canonical(a) === canonical(b); }
function omit(v, keys) { return Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k))); }
function tree(v, depth = 0) {
  requireValue(depth <= 40);
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") { requireValue(Number.isFinite(v)); return; }
  requireValue(object(v) || Array.isArray(v));
  for (const child of Object.values(v)) tree(child, depth + 1);
}
function parse(raw, pretty = false) {
  let value;
  try { value = JSON.parse(raw); } catch { fail("PC_PAYLOAD_INVALID"); }
  // These are the actual store/client writer forms. Equality also rejects
  // duplicate object properties, lossy numbers and noncanonical UTF-8 input.
  requireValue(raw === (pretty ? JSON.stringify(value, null, 2) + "\n" : JSON.stringify(value)));
  tree(value); return value;
}
function validateWork(p) {
  requireValue(shape(p, ["idempotencyKey", "goalIssue", "targetNodeId", "privacyClass", "content", "capsule"], ["idempotencyKey", "goalIssue", "privacyClass", "content", "capsule"]) && typeof p.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{1,150}$/.test(p.idempotencyKey) && integer(p.goalIssue) && p.goalIssue > 0 && p.privacyClass === "PUBLIC" && typeof p.content === "string" && Buffer.byteLength(p.content) <= 32768);
  requireValue(p.targetNodeId === undefined || typeof p.targetNodeId === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(p.targetNodeId));
  const c = p.capsule;
  requireValue(shape(c, CAPSULE) && Buffer.byteLength(JSON.stringify(c)) <= 16384 && c.goal === `#${p.goalIssue}`);
  for (const k of ["goal", "currentJob", "why", "workflowPosition", "verificationContract"]) requireValue(text(c[k]) && c[k].trim());
  for (const k of ["inputs", "constraints", "decisions", "dependencies", "expectedOutput", "definitionOfDone", "recoveryContext"]) requireValue(Array.isArray(c[k]) && c[k].length <= 1000 && c[k].every(v => typeof v === "string" && v.length <= 16384));
}
function validateResult(r, task, observation = false) {
  requireValue(shape(r, RESULT_KEYS) && hex(r.sha256) && r.sha256 === hash(task.payload.content) && r.bytes === Buffer.byteLength(task.payload.content) && text(r.nodeId, 100) && r.goalIssue === task.payload.goalIssue && r.verified === true && r.issuer === "signed-worker-request" && r.executionEpoch === task.executionEpoch && r.executionEpoch > 0 && date(r.observedAt) && (!task.payload.targetNodeId || task.payload.targetNodeId === r.nodeId) && (!observation || node(r.nodeId)));
}
function validTransition(from, to) {
  if (from === null) return to === "queued";
  if (TERMINAL.includes(from)) return false;
  if (to === "cancelled") return true;
  if (from === "queued" || from === "retrying") return ["leased", "waiting-dependency", "waiting-connectivity", "waiting-resource", "failed"].includes(to);
  if (from === "leased") return ["running", "completed", "ready-to-publish", "retrying", "failed", "waiting-connectivity", "waiting-resource"].includes(to);
  if (from === "running") return ["completed", "ready-to-publish", "retrying", "failed", "waiting-connectivity", "waiting-resource"].includes(to);
  if (from === "ready-to-publish") return to === "completed";
  return ["queued", "failed", "retrying"].includes(to);
}
function validateTask(t) {
  requireValue(shape(t, TASK_KEYS, TASK_REQUIRED)); validateWork(t.payload);
  requireValue(t.id === "pc-" + hash(`${t.payload.goalIssue}:${t.payload.idempotencyKey}`) && t.idempotencyKey === t.id && t.type === "pc-public-file-sha256" && same(t.requiredCapabilities, ["filesystem"]) && same(t.dependsOn, []) && t.migrationClass === "RESTARTABLE" && t.pinnedNodeId === undefined && t.maxAttempts === 3 && ["urgent", "high", "normal", "low", "background"].includes(t.priority) && STATUSES.includes(t.status) && integer(t.attempts) && t.attempts <= t.maxAttempts && integer(t.executionEpoch) && date(t.createdAt) && date(t.updatedAt) && Date.parse(t.updatedAt) >= Date.parse(t.createdAt));
  requireValue(Array.isArray(t.history) && t.history.length > 0 && t.history.length <= 10000);
  let previous = null, at = Date.parse(t.createdAt), leases = 0, leaseActor = null, leaseEpoch = 0;
  for (const e of t.history) {
    requireValue(shape(e, ["from", "to", "at", "reason", "actor", "evidence"], ["from", "to", "at", "reason"]) && e.from === previous && validTransition(e.from, e.to) && date(e.at) && Date.parse(e.at) >= at && text(e.reason) && (e.actor === undefined || text(e.actor, 200)) && (e.evidence === undefined || object(e.evidence)));
    if (e.to === "leased") { leases++; requireValue(text(e.actor, 200)); leaseActor = e.actor; leaseEpoch = leases; }
    if (e.to === "running") requireValue(leaseActor !== null && e.actor === leaseActor);
    if (["leased", "running"].includes(e.from) && e.actor !== undefined) requireValue(e.actor === leaseActor);
    // The legacy owner-based runtime omits evidence; claimed transitions carry
    // the current epoch. Neither form may contradict the history's live lease.
    if (e.evidence && Object.hasOwn(e.evidence, "executionEpoch")) requireValue(leaseActor !== null && e.evidence.executionEpoch === leaseEpoch);
    if (!["leased", "running"].includes(e.to)) leaseActor = null;
    previous = e.to; at = Date.parse(e.at);
  }
  requireValue(previous === t.status && t.history[0].at === t.createdAt && at <= Date.parse(t.updatedAt) && t.attempts === leases && t.executionEpoch === leases);
  const active = ["leased", "running"].includes(t.status);
  requireValue(active ? text(t.leaseOwner, 200) && text(t.fencingToken, 200) && date(t.leaseUntil) && leases > 0 && leaseActor === t.leaseOwner && leaseEpoch === t.executionEpoch : t.leaseOwner === undefined && t.leaseUntil === undefined && t.fencingToken === undefined);
  requireValue(t.nextAttemptAt === undefined || date(t.nextAttemptAt));
  requireValue(t.checkpointRef === undefined || text(t.checkpointRef));
  requireValue(t.error === undefined || text(t.error));
  requireValue(t.waitReason === undefined || ["connectivity", "resource", "pinned-node", "migration-checkpoint", "side-effect-reconciliation"].includes(t.waitReason));
  if (t.status === "completed") {
    validateResult(t.result, t);
    const last = t.history.at(-1); requireValue(last.actor === t.result.nodeId && last.at === t.result.observedAt && last.evidence?.executionEpoch === t.executionEpoch && t.history.findLast(e => e.to === "leased")?.actor === t.result.nodeId);
  } else requireValue(t.result === undefined);
}
function validateTasks(s) {
  if (s === null) return;
  requireValue(shape(s, ["version", "tasks", "savedAt"]) && s.version === 1 && date(s.savedAt) && Array.isArray(s.tasks) && s.tasks.length <= 10000);
  s.tasks.forEach(validateTask); requireValue(new Set(s.tasks.map(t => t.id)).size === s.tasks.length);
}
function validateObservation(o) {
  const keys = "version id idempotencyKey type payload migrationClass requiredCapabilities status executionEpoch sequence claim result".split(" ");
  requireValue(shape(o, keys, keys.filter(k => !["claim", "result"].includes(k))) && Buffer.byteLength(JSON.stringify(o)) <= 65536);
  validateWork(o.payload);
  requireValue(o.version === 1 && o.payload.goalIssue === 1219 && (!o.payload.targetNodeId || node(o.payload.targetNodeId)) && o.id === "pc-" + hash(`${o.payload.goalIssue}:${o.payload.idempotencyKey}`) && o.idempotencyKey === o.id && o.type === "pc-public-file-sha256" && o.migrationClass === "RESTARTABLE" && same(o.requiredCapabilities, ["filesystem"]) && STATUSES.includes(o.status) && integer(o.executionEpoch) && integer(o.sequence) && o.sequence >= 1);
  if (["leased", "running"].includes(o.status)) {
    const c = o.claim;
    requireValue(shape(c, ["taskId", "owner", "epoch", "fencingToken", "leaseUntil"]) && c.taskId === o.id && node(c.owner) && c.epoch === o.executionEpoch && c.epoch > 0 && typeof c.fencingToken === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(c.fencingToken) && date(c.leaseUntil) && (!o.payload.targetNodeId || o.payload.targetNodeId === c.owner));
  } else requireValue(o.claim === undefined);
  if (o.status === "completed") validateResult(o.result, o, true); else requireValue(o.result === undefined);
}
function validateVariant(v, taskId) {
  requireValue(shape(v, ["digest", "sourceNodeId", "observation", "provenance"]) && hex(v.digest) && node(v.sourceNodeId));
  validateObservation(v.observation); requireValue(v.observation.id === taskId && hash(canonical(v.observation)) === v.digest);
  const p = v.provenance;
  requireValue(shape(p, ["rawBody", "signed", "identity"]) && typeof p.rawBody === "string" && Buffer.byteLength(p.rawBody) <= 65536);
  const body = parse(p.rawBody), s = p.signed, i = p.identity;
  requireValue(shape(body, ["taskId", "revision", "sourceNodeId", "observation"]) && body.taskId === taskId && hex(body.revision, 40) && body.sourceNodeId === v.sourceNodeId && same(body.observation, v.observation));
  requireValue(shape(s, SIGNED_KEYS) && s.nodeId === v.sourceNodeId && date(s.timestamp) && text(s.nonce) && s.method === "POST" && s.path === RECEIVE_PATH && s.bodySha256 === hash(p.rawBody) && typeof s.signatureBase64 === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(s.signatureBase64));
  requireValue(shape(i, ["nodeId", "publicKeyPem", "enrolledAt", "algorithm", "revokedAt"], ["nodeId", "publicKeyPem", "enrolledAt"]) && i.nodeId === v.sourceNodeId && text(i.publicKeyPem) && date(i.enrolledAt) && i.algorithm === "ed25519" && i.revokedAt === undefined);
  try {
    const key = createPublicKey(i.publicKeyPem), sig = Buffer.from(s.signatureBase64, "base64");
    requireValue(key.asymmetricKeyType === "ed25519" && sig.length === 64 && sig.toString("base64") === s.signatureBase64 && verify(null, Buffer.from([s.nodeId, s.timestamp, s.nonce, s.method, s.path, s.bodySha256].join("\n")), key, sig));
  } catch (error) { if (ownErrors.has(error)) throw error; fail("PC_PAYLOAD_INVALID"); }
  // Historical signatures are checked cryptographically, without current-time
  // freshness/replay side effects or granting a new execution claim.
}
function incompatible(a, b) {
  const x = a.observation, y = b.observation;
  if (!same(x.payload, y.payload)) return true;
  if (a.sourceNodeId === b.sourceNodeId && x.sequence === y.sequence && a.digest !== b.digest) return true;
  const terminal = o => TERMINAL.includes(o.status);
  if (a.sourceNodeId === b.sourceNodeId && x.sequence !== y.sequence) {
    const [older, newer] = x.sequence < y.sequence ? [x, y] : [y, x];
    if (newer.executionEpoch < older.executionEpoch || terminal(older) && (older.status !== newer.status || older.executionEpoch !== newer.executionEpoch || !same(older.result, newer.result))) return true;
  }
  if (x.executionEpoch !== y.executionEpoch) return a.sourceNodeId !== b.sourceNodeId && !!(x.claim || y.claim || x.result || y.result || terminal(x) || terminal(y));
  if (x.claim && y.claim && (x.claim.owner !== y.claim.owner || x.claim.fencingToken !== y.claim.fencingToken)) return true;
  if (x.result && y.result && !same(x.result, y.result)) return true;
  if (x.claim && y.result && x.claim.owner !== y.result.nodeId || y.claim && x.result && y.claim.owner !== x.result.nodeId) return true;
  if (terminal(x) && terminal(y) && x.status !== y.status) return true;
  return a.sourceNodeId !== b.sourceNodeId && terminal(x) !== terminal(y) && !!(x.claim || y.claim);
}
function validateObservations(s) {
  if (s === null) return;
  requireValue(shape(s, ["version", "records", "savedAt"]) && s.version === 1 && date(s.savedAt) && Array.isArray(s.records) && s.records.length <= 64);
  for (const r of s.records) {
    requireValue(shape(r, ["recordId", "entityType", "version", "deviceId", "updatedAt", "clock", "syncState", "ownerTaskId", "verification", "value"]) && text(r.recordId) && r.entityType === "evidence" && r.deviceId === "pc-observation-adapter" && r.ownerTaskId === r.recordId && r.syncState === "pending-push" && date(r.updatedAt) && integer(r.version) && r.version > 0 && shape(r.clock, ["pc-observation-adapter"]) && r.clock["pc-observation-adapter"] === r.version && same(r.verification, { status: "unverified" }));
    const b = r.value;
    requireValue(shape(b, ["version", "taskId", "conflicted", "variants"]) && b.version === 1 && b.taskId === r.recordId && typeof b.conflicted === "boolean" && Array.isArray(b.variants) && b.variants.length > 0 && b.variants.length <= 16 && r.version === b.variants.length);
    b.variants.forEach(v => validateVariant(v, r.recordId));
    requireValue(new Set(b.variants.map(v => v.sourceNodeId + ":" + v.digest)).size === b.variants.length);
    requireValue(b.conflicted || !b.variants.some((v, i) => b.variants.slice(i + 1).some(w => incompatible(v, w))));
  }
  requireValue(new Set(s.records.map(r => r.recordId)).size === s.records.length);
}
function pcSidecarSummary(s) {
  return Object.freeze({ profile: PROFILE, taskFilePresent: s.tasks !== null, observationFilePresent: s.observations !== null, taskCount: s.tasks?.tasks.length ?? 0, observationCount: s.observations?.records.length ?? 0, variantCount: s.observations?.records.reduce((n, r) => n + r.value.variants.length, 0) ?? 0, coverage: COVERAGE });
}
function prefix(a, b) { return b.length >= a.length && a.every((v, i) => same(v, b[i])); }
function taskProgress(a, b) {
  if (Date.parse(b.updatedAt) < Date.parse(a.updatedAt) || b.attempts < a.attempts || b.executionEpoch < a.executionEpoch) return false;
  if (TERMINAL.includes(a.status)) return same(a, b);
  if (a.history.length === b.history.length) {
    if (!same(omit(a, ["updatedAt", "leaseUntil"]), omit(b, ["updatedAt", "leaseUntil"]))) return false;
    return a.leaseUntil === b.leaseUntil || ["leased", "running"].includes(a.status) && Date.parse(b.leaseUntil) >= Date.parse(a.leaseUntil);
  }
  const leases = b.history.slice(a.history.length).filter(e => e.to === "leased").length;
  if (b.attempts - a.attempts !== leases || b.executionEpoch - a.executionEpoch !== leases) return false;
  if (["leased", "running"].includes(a.status) && ["leased", "running"].includes(b.status) && leases === 0 && (a.leaseOwner !== b.leaseOwner || a.fencingToken !== b.fencingToken || Date.parse(b.leaseUntil) < Date.parse(a.leaseUntil))) return false;
  return true;
}
function comparePcSidecarSnapshots(a, b) {
  const reasons = [];
  const bindingMatched = same(a.bound, b.bound);
  const baselinePresenceMatched = (a.tasks !== null) === (a.bound.expectedTaskFile === "present") && (a.observations !== null) === (a.bound.expectedObservationFile === "present");
  const taskFilesRetained = a.tasks === null || b.tasks !== null;
  const observationFilesRetained = a.observations === null || b.observations !== null;
  const oldTasks = a.tasks?.tasks ?? [], newTasks = b.tasks?.tasks ?? [], tm = new Map(newTasks.map(t => [t.id, t]));
  const taskContractsPreserved = taskFilesRetained && oldTasks.every(t => tm.has(t.id) && same(omit(t, RUNTIME), omit(tm.get(t.id), RUNTIME)));
  const taskHistoryPreserved = taskFilesRetained && oldTasks.every(t => tm.has(t.id) && prefix(t.history, tm.get(t.id).history));
  const taskRuntimeValid = oldTasks.every(t => tm.has(t.id) && taskProgress(t, tm.get(t.id)));
  const oldRecords = a.observations?.records ?? [], newRecords = b.observations?.records ?? [], rm = new Map(newRecords.map(r => [r.recordId, r]));
  const observationProvenancePreserved = observationFilesRetained && oldRecords.every(r => {
    const n = rm.get(r.recordId);
    return n && same(omit(r, ["version", "updatedAt", "clock", "value"]), omit(n, ["version", "updatedAt", "clock", "value"])) && prefix(r.value.variants, n.value.variants) && (!r.value.conflicted || n.value.conflicted) && n.version >= r.version && Date.parse(n.updatedAt) >= Date.parse(r.updatedAt) && (n.version > r.version || same(r, n));
  });
  for (const [valid, code] of [[bindingMatched, "PC_BINDING_CHANGED"], [baselinePresenceMatched, "PC_BASELINE_PRESENCE_MISMATCH"], [taskContractsPreserved, "PC_TASK_CONTRACT_CHANGED"], [taskHistoryPreserved, "PC_TASK_HISTORY_LOST"], [taskRuntimeValid, "PC_TASK_RUNTIME_UNSUPPORTED"], [observationProvenancePreserved, "PC_OBSERVATION_PROVENANCE_CHANGED"]]) if (!valid) reasons.push(code);
  const operationalChanges = Object.freeze({ tasksAdded: newTasks.filter(t => !oldTasks.some(o => o.id === t.id)).length, tasksAdvanced: oldTasks.filter(t => tm.has(t.id) && !same(t, tm.get(t.id))).length, recordsAdded: newRecords.filter(r => !oldRecords.some(o => o.recordId === r.recordId)).length, variantsAdded: newRecords.reduce((n, r) => n + Math.max(0, r.value.variants.length - (oldRecords.find(o => o.recordId === r.recordId)?.value.variants.length ?? 0)), 0) });
  return Object.freeze({ status: reasons.length ? "FAIL" : "PASS", bindingMatched, taskContractsPreserved, taskHistoryPreserved, observationProvenancePreserved, operationalChanges, reasonCodes: Object.freeze(reasons), coverage: COVERAGE });
}

function project(path, options, input) {
  requireValue(shape(input, ['tasksText', 'observationsText']));
  const contents = (raw, expected) => {
    if (raw === null) { requireValue(expected === 'absent'); return null; }
    requireValue(typeof raw === 'string' && Buffer.byteLength(raw) > 0 && Buffer.byteLength(raw) <= MAX_BYTES);
    return parse(raw, true);
  };
  const tasks = contents(input.tasksText, options.expectedTaskFile), observations = contents(input.observationsText, options.expectedObservationFile);
  validateTasks(tasks); validateObservations(observations);
  return {bound: {path, ...options}, tasks, observations};
}
return Object.freeze({project, summary: pcSidecarSummary, compare: comparePcSidecarSnapshots});
})();
const PROFILE = "jarvis-control-plane-sqlite-v1";
const snapshots = new WeakMap(), observers = new WeakMap(), owners = new WeakMap();
const ownErrors = new WeakSet();
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const COVERAGE = Object.freeze({ fleetSqlite: true, workerPublicKeys: true, workerLifecycleHistory: true, retainedAudit: true, taskQueuePayloads: true, workerPrivateKeys: false, pcTaskSidecars: false, compassHistory: false, wholeR06: false });
const TABLE_SQL = {
  jarvis_state: "CREATE TABLE jarvis_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT",
  jarvis_worker_identity: "CREATE TABLE jarvis_worker_identity (node_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT",
  jarvis_worker_nonce: "CREATE TABLE jarvis_worker_nonce (node_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (node_id, nonce)) STRICT",
};
const SCHEMA = {
  ...Object.fromEntries(Object.entries(TABLE_SQL).map(([name, sql]) => [name, { type: "table", table: name, sql }])),
  jarvis_worker_nonce_expires_at: { type: "index", table: "jarvis_worker_nonce", sql: "CREATE INDEX jarvis_worker_nonce_expires_at ON jarvis_worker_nonce (expires_at)" },
  sqlite_autoindex_jarvis_worker_identity_1: { type: "index", table: "jarvis_worker_identity", sql: null },
  sqlite_autoindex_jarvis_worker_nonce_1: { type: "index", table: "jarvis_worker_nonce", sql: null },
};
const NODE_KEYS = ["id", "label", "kind", "status", "capabilities", "policy", "telemetry", "nodeContract", "pcAuthority", "enrollment", "fleetNumber", "group", "lastSeenAt"];
const TELEMETRY_KEYS = ["remoteProtocol", "androidApi", "batteryPercent", "charging", "temperatureC", "freeStorageMb", "cpuLoadPercent", "gpuLoadPercent", "memoryAvailableMb", "cpuAvailable", "gpuAvailable", "onExternalPower", "thermalState", "dataLocalityKeys", "network", "deviceOwner", "adminActive", "accessibilityEnabled", "locked", "screenInteractive", "checkedAt"];
const TASK_KEYS = ["id", "idempotencyKey", "type", "payload", "status", "requiredCapabilities", "preferredKinds", "resourceRequirements", "priority", "requiresOnline", "targetNodeId", "assignedNodeId", "leaseUntil", "dispatchBefore", "attempts", "maxAttempts", "createdAt", "updatedAt"];
const TASK_RUNTIME = ["status", "assignedNodeId", "leaseUntil", "attempts", "updatedAt"];
const KINDS = ["android", "ios", "windows", "macos", "linux", "cloud"];
const CAPABILITIES = ["browser", "open-url", "open-app", "launch-settings", "device-status", "show-notification", "lock-device", "reboot", "device-owner", "ui-automation", "self-update", "filesystem", "windows-tooling", "camera", "gps", "bluetooth", "local-model", "speech-to-text", "text-to-speech", "gpu", "remote-view", "remote-control", "wake-device", "background-worker", "long-running"];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  ownErrors.add(error);
  throw error;
}
function requireValue(condition, code = "FLEET_PAYLOAD_INVALID") { if (!condition) fail(code); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value, allowed, required = []) {
  return object(value) && Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}
function string(value) { return typeof value === "string" && value.length > 0 && value.length <= 16_384; }
function date(value) { return string(value) && Number.isFinite(Date.parse(value)); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function strings(value, allowed) { return Array.isArray(value) && value.length <= 1000 && value.every((item) => string(item) && (!allowed || allowed.includes(item))) && new Set(value).size === value.length; }
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (object(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function same(left, right) { return canonical(left) === canonical(right); }
function omit(value, excluded) { return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.includes(key))); }
function jsonTree(value, depth = 0) {
  requireValue(depth <= 40);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { requireValue(Number.isFinite(value)); return; }
  requireValue(Array.isArray(value) || object(value));
  for (const child of Object.values(value)) jsonTree(child, depth + 1);
}
function parsePayload(raw) {
  requireValue(typeof raw === "string" && Buffer.byteLength(raw) <= MAX_JSON_BYTES);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail("FLEET_PAYLOAD_INVALID"); }
  // The canonical store writes JSON.stringify. Reject duplicate-key and unknown storage forms.
  requireValue(JSON.stringify(parsed) === raw);
  jsonTree(parsed);
  return parsed;
}
function optional(value, key, predicate) { return !Object.hasOwn(value, key) || predicate(value[key]); }
function uniqueIdArray(value, max) {
  requireValue(Array.isArray(value) && value.length <= max);
  requireValue(value.every((item) => object(item) && string(item.id)) && new Set(value.map((item) => item.id)).size === value.length);
}
function validateNode(node) {
  requireValue(keys(node, NODE_KEYS, ["id", "label", "kind", "status", "capabilities", "policy", "telemetry", "enrollment", "lastSeenAt"]));
  requireValue(string(node.label) && KINDS.includes(node.kind) && ["ready", "busy", "offline", "locked", "needs-human", "disabled"].includes(node.status));
  requireValue(strings(node.capabilities, CAPABILITIES) && ["quick", "full"].includes(node.enrollment) && date(node.lastSeenAt));
  const policy = node.policy;
  const policyKeys = ["allowPaidServices", "allowDestructiveActions", "allowExternalPublication", "allowRemoteControl", "requireHumanForLockedDevice"];
  requireValue(keys(policy, policyKeys, policyKeys) && policyKeys.every((key) => typeof policy[key] === "boolean") && policy.allowPaidServices === false);
  requireValue(keys(node.telemetry, TELEMETRY_KEYS, ["checkedAt"]) && date(node.telemetry.checkedAt));
  const booleanTelemetry = ["charging", "cpuAvailable", "gpuAvailable", "onExternalPower", "deviceOwner", "adminActive", "accessibilityEnabled", "locked", "screenInteractive"];
  for (const [key, value] of Object.entries(node.telemetry)) {
    if (key === "checkedAt") continue;
    requireValue(booleanTelemetry.includes(key) ? typeof value === "boolean" : key === "dataLocalityKeys" ? strings(value) : key === "network" ? ["wifi", "cellular", "lan", "offline"].includes(value) : key === "thermalState" ? ["nominal", "fair", "serious", "critical"].includes(value) : typeof value === "number" && Number.isFinite(value));
  }
  requireValue(optional(node, "fleetNumber", integer) && optional(node, "group", string));
  if (node.pcAuthority !== undefined) {
    const a = node.pcAuthority;
    requireValue(keys(a, ["version", "approvalIssue", "goalIssue", "roles", "capabilityCeiling"], ["version", "approvalIssue", "goalIssue", "roles", "capabilityCeiling"]) && a.version === 1 && integer(a.approvalIssue) && integer(a.goalIssue) && strings(a.roles, ["Executor", "Storage", "Verifier", "Coordinator"]) && strings(a.capabilityCeiling, CAPABILITIES));
  }
  if (node.nodeContract !== undefined) {
    const c = node.nodeContract;
    const fields = ["schemaVersion", "platform", "architecture", "executionModes", "networkRequirement", "persistence", "migration", "security", "constraints", "resources", "checkedAt"];
    requireValue(keys(c, fields, fields) && c.schemaVersion === 1 && c.platform === "android" && (c.architecture === null || string(c.architecture)) && strings(c.executionModes, ["foreground", "background-scheduled", "deferred"]) && c.executionModes.length > 0 && c.networkRequirement === "offline-capable" && date(c.checkedAt));
    for (const [key, fields] of [["persistence", ["localState", "checkpointResume", "offlineQueue"]], ["security", ["credentialIsolation", "taskScopedAuthorization"]], ["constraints", ["residentExecution", "lockedUiRequiresHuman"]]]) requireValue(keys(c[key], fields, fields) && fields.every((field) => typeof c[key][field] === "boolean"));
    requireValue(keys(c.migration, ["supported", "checkpointResume", "sideEffectingFencing"], ["supported", "checkpointResume", "sideEffectingFencing"]) && strings(c.migration.supported, ["RESTARTABLE", "PINNED"]) && typeof c.migration.checkpointResume === "boolean" && typeof c.migration.sideEffectingFencing === "boolean");
    requireValue(keys(c.resources, ["cpuCores", "memoryAvailableMb", "freeStorageMb", "batteryPercent", "charging", "network"]));
    for (const [key, value] of Object.entries(c.resources)) requireValue(key === "charging" ? typeof value === "boolean" : key === "network" ? ["wifi", "cellular", "lan", "offline"].includes(value) : typeof value === "number" && Number.isFinite(value));
  }
}
function validateState(state) {
  const fields = ["generatedAt", "fleet", "tasks", "activeTakeovers", "audit", "stats"];
  requireValue(keys(state, fields, fields) && date(state.generatedAt));
  uniqueIdArray(state.fleet, 100); state.fleet.forEach(validateNode);
  uniqueIdArray(state.tasks, 10_000);
  for (const task of state.tasks) {
    requireValue(keys(task, TASK_KEYS, ["id", "idempotencyKey", "type", "payload", "status", "requiredCapabilities", "priority", "requiresOnline", "attempts", "maxAttempts", "createdAt", "updatedAt"]));
    requireValue(string(task.idempotencyKey) && string(task.type) && object(task.payload) && strings(task.requiredCapabilities, CAPABILITIES) && ["urgent", "high", "normal", "low", "background"].includes(task.priority) && typeof task.requiresOnline === "boolean");
    requireValue(["queued", "leased", "running", "waiting-connectivity", "waiting-human", "completed", "failed", "cancelled"].includes(task.status) && integer(task.attempts) && integer(task.maxAttempts) && date(task.createdAt) && date(task.updatedAt));
    requireValue(optional(task, "preferredKinds", (v) => strings(v, KINDS)) && optional(task, "targetNodeId", string) && optional(task, "assignedNodeId", string) && optional(task, "leaseUntil", date) && optional(task, "dispatchBefore", date));
    if (task.resourceRequirements !== undefined) requireValue(object(task.resourceRequirements));
  }
  uniqueIdArray(state.audit, 1000);
  for (const event of state.audit) requireValue(keys(event, ["id", "at", "actor", "action", "target", "detail"], ["id", "at", "actor", "action"]) && date(event.at) && string(event.actor) && string(event.action) && optional(event, "target", string) && optional(event, "detail", object));
  uniqueIdArray(state.activeTakeovers, 10_000);
  for (const session of state.activeTakeovers) requireValue(keys(session, ["id", "nodeId", "taskId", "status", "reason", "lastAction", "currentUrl", "appName", "screenshotRef", "createdAt", "updatedAt"], ["id", "nodeId", "status", "reason", "createdAt", "updatedAt"]) && string(session.nodeId) && string(session.reason) && ["requested", "active", "resolved", "cancelled"].includes(session.status) && date(session.createdAt) && date(session.updatedAt) && ["taskId", "lastAction", "currentUrl", "appName", "screenshotRef"].every((key) => optional(session, key, string)));
  const stats = ["registered", "ready", "offline", "needsHuman", "queued", "running", "completed", "failed"];
  requireValue(keys(state.stats, stats, stats) && stats.every((key) => integer(state.stats[key])));
  const expected = { registered: state.fleet.length, ready: state.fleet.filter((n) => n.status === "ready").length, offline: state.fleet.filter((n) => n.status === "offline").length, needsHuman: state.fleet.filter((n) => ["needs-human", "locked"].includes(n.status)).length, queued: state.tasks.filter((task) => ["queued", "waiting-connectivity"].includes(task.status)).length, running: state.tasks.filter((task) => ["leased", "running"].includes(task.status)).length, completed: state.tasks.filter((task) => task.status === "completed").length, failed: state.tasks.filter((task) => task.status === "failed").length };
  requireValue(same(state.stats, expected));
}
function validateIdentity(row) {
  requireValue(string(row.node_id) && date(row.updated_at));
  const identity = parsePayload(row.payload);
  requireValue(keys(identity, ["nodeId", "publicKeyPem", "enrolledAt", "algorithm", "revokedAt"], ["nodeId", "publicKeyPem", "enrolledAt"]) && identity.nodeId === row.node_id && string(identity.publicKeyPem) && date(identity.enrolledAt) && optional(identity, "revokedAt", date));
  const algorithm = identity.algorithm ?? "ed25519";
  requireValue(["ed25519", "ecdsa-p256-sha256"].includes(algorithm));
  requireValue(!identity.revokedAt || Date.parse(identity.revokedAt) >= Date.parse(identity.enrolledAt));
  try {
    const key = createPublicKey(identity.publicKeyPem);
    requireValue(algorithm === "ed25519" ? key.asymmetricKeyType === "ed25519" : key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1");
  } catch { fail("FLEET_PAYLOAD_INVALID"); }
  return { nodeId: row.node_id, payload: identity, updatedAt: row.updated_at };
}
function normalizeSql(sql) { return sql === null ? null : sql.toLowerCase().replace(/\s+/g, "").replace("ifnotexists", "").replace(/;$/, ""); }
function boundOptions(path, options) {
  const code = "FLEET_OPTIONS_INVALID";
  const hex = (value, count) => typeof value === "string" && new RegExp(`^[a-f0-9]{${count}}$`).test(value);
  requireValue(typeof path === "string" && isAbsolute(path) && keys(options, ["schemaProfile", "databaseBinding", "cohortAuthority", "timeoutMs", "pcSidecars"], ["schemaProfile", "databaseBinding", "cohortAuthority"]) && options.schemaProfile === PROFILE, code);
  const binding = options.databaseBinding;
  requireValue(keys(binding, ["path", "configSha256", "taskSha256", "releaseRevision"], ["path", "configSha256", "taskSha256", "releaseRevision"]) && typeof binding.path === "string" && isAbsolute(binding.path) && resolve(binding.path) === resolve(path) && hex(binding.configSha256, 64) && hex(binding.taskSha256, 64) && hex(binding.releaseRevision, 40), code);
  const authority = options.cohortAuthority;
  requireValue(keys(authority, ["kind", "approvalSha256", "expectedCount", "cohortSha256"], ["kind", "approvalSha256", "expectedCount"]) && ["approved-active-capture", "original-cohort-digest"].includes(authority.kind) && hex(authority.approvalSha256, 64) && Number.isSafeInteger(authority.expectedCount) && authority.expectedCount > 0 && authority.expectedCount <= 100, code);
  requireValue(authority.kind === "original-cohort-digest" ? hex(authority.cohortSha256, 64) : !Object.hasOwn(authority, "cohortSha256"), code);
  requireValue(options.timeoutMs === undefined || Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 5000, code);
  if (options.pcSidecars !== undefined) requireValue(keys(options.pcSidecars, ["profile", "expectedTaskFile", "expectedObservationFile"], ["profile", "expectedTaskFile", "expectedObservationFile"]) && options.pcSidecars.profile === "jarvis-pc-sidecars-v1" && ["present", "absent"].includes(options.pcSidecars.expectedTaskFile) && ["present", "absent"].includes(options.pcSidecars.expectedObservationFile), code);
  return { binding: { ...binding }, authority: { ...authority }, timeout: options.timeoutMs ?? 5000, pcSidecars: options.pcSidecars === undefined ? undefined : { ...options.pcSidecars } };
}
function data(handle) {
  requireValue(object(handle) && snapshots.has(handle), "FLEET_HANDLE_INVALID");
  return snapshots.get(handle);
}

function fleetSnapshotSummary(handle) {
  const snapshot = data(handle);
  return Object.freeze({ schemaProfile: PROFILE, fleetCount: snapshot.state.fleet.length, identityCount: snapshot.identities.length, revokedIdentityCount: snapshot.identities.filter((identity) => identity.payload.revokedAt).length, taskCount: snapshot.state.tasks.length, auditCount: snapshot.state.audit.length, nonceCount: snapshot.nonces.length, cohortAuthorityVerified: true, pcSidecars: snapshot.pc ? pc.summary(snapshot.pc) : null, coverage: snapshot.pc ? Object.freeze({ ...COVERAGE, pcTaskSidecars: true, pcObservationSidecars: true, crossStoreAtomicity: false }) : COVERAGE });
}

function fleetStable(node) {
  const result = omit(node, ["status", "lastSeenAt", "telemetry"]);
  if (result.nodeContract) result.nodeContract = omit(result.nodeContract, ["checkedAt", "resources"]);
  return result;
}
function byId(values) { return new Map(values.map((value) => [value.id, value])); }
function preserved(before, after, projection = (value) => value) {
  const next = byId(after);
  return before.every((value) => next.has(value.id) && same(projection(value), projection(next.get(value.id))));
}
function changes(before, after) {
  const next = byId(after);
  return before.filter((value) => !next.has(value.id) || !same(value, next.get(value.id))).length + after.filter((value) => !before.some((old) => old.id === value.id)).length;
}

function compareFleetSnapshots(beforeHandle, afterHandle) {
  const before = data(beforeHandle), after = data(afterHandle);
  const reasons = [];
  const databaseBindingMatched = same(before.bound.binding, after.bound.binding) && same(before.file, after.file);
  const cohortAuthorityVerified = same(before.bound.authority, after.bound.authority);
  const baselineCohortPreserved = before.state.fleet.length === after.state.fleet.length && preserved(before.state.fleet, after.state.fleet, (node) => node.id);
  const fleetMetadataPreserved = baselineCohortPreserved && preserved(before.state.fleet, after.state.fleet, fleetStable);
  const oldIdentities = before.identities.map((row) => ({ id: row.nodeId, ...row }));
  const newIdentities = after.identities.map((row) => ({ id: row.nodeId, ...row }));
  const identitiesPreserved = oldIdentities.length === newIdentities.length && preserved(oldIdentities, newIdentities);
  const keysPreserved = oldIdentities.length === newIdentities.length && preserved(oldIdentities, newIdentities, (row) => ({ id: row.id, publicKeyPem: row.payload.publicKeyPem, algorithm: row.payload.algorithm }));
  const workerLifecycleHistoryPreserved = oldIdentities.length === newIdentities.length && preserved(oldIdentities, newIdentities, (row) => ({ id: row.id, enrolledAt: row.payload.enrolledAt, revokedAt: row.payload.revokedAt }));
  const oldAudit = before.state.audit, newAudit = after.state.audit;
  const auditRetainedHistoryPreserved = newAudit.length >= oldAudit.length && oldAudit.every((event, index) => same(event, newAudit[index]));
  let auditRolled = false;
  if (!auditRetainedHistoryPreserved && oldAudit.length === 1000 && newAudit.length === 1000) {
    const shifted = oldAudit.findIndex((event) => event.id === newAudit[0].id);
    auditRolled = shifted > 0 && oldAudit.slice(shifted).every((event, index) => same(event, newAudit[index]));
    if (shifted < 0) auditRolled = !newAudit.some((event) => oldAudit.some((old) => old.id === event.id));
  }
  const afterTasks = byId(after.state.tasks);
  const taskPayloadsPreserved = preserved(before.state.tasks, after.state.tasks, (task) => omit(task, TASK_RUNTIME)) && before.state.tasks.every((task) => afterTasks.get(task.id).attempts >= task.attempts && Date.parse(afterTasks.get(task.id).updatedAt) >= Date.parse(task.updatedAt));
  const nonceKey = (nonce) => JSON.stringify([nonce.node_id, nonce.nonce]);
  const afterNonces = new Map(after.nonces.map((nonce) => [nonceKey(nonce), nonce]));
  const nonceProtectionPreserved = before.nonces.filter((nonce) => nonce.expires_at > after.capturedAt).every((nonce) => same(nonce, afterNonces.get(nonceKey(nonce))));
  const takeoversPreserved = preserved(before.state.activeTakeovers.filter((session) => after.state.activeTakeovers.some((next) => next.id === session.id)), after.state.activeTakeovers, (session) => omit(session, ["status", "lastAction", "currentUrl", "appName", "screenshotRef", "updatedAt"]));
  for (const [valid, code] of [[databaseBindingMatched, "FLEET_DATABASE_BINDING_CHANGED"], [cohortAuthorityVerified, "FLEET_COHORT_AUTHORITY_CHANGED"], [baselineCohortPreserved, "FLEET_COHORT_CHANGED"], [fleetMetadataPreserved, "FLEET_METADATA_CHANGED"], [identitiesPreserved, "FLEET_IDENTITIES_CHANGED"], [keysPreserved, "FLEET_KEYS_CHANGED"], [workerLifecycleHistoryPreserved, "FLEET_LIFECYCLE_CHANGED"], [taskPayloadsPreserved, "FLEET_TASK_PAYLOAD_CHANGED"], [nonceProtectionPreserved, "FLEET_LIVE_NONCE_LOST"], [takeoversPreserved, "FLEET_TAKEOVER_CHANGED"]]) if (!valid) reasons.push(code);
  if (!auditRetainedHistoryPreserved) reasons.push(auditRolled ? "FLEET_AUDIT_WINDOW_ROLLED" : "FLEET_AUDIT_CHANGED");
  let pcSidecars = null;
  if (before.pc && after.pc) { pcSidecars = pc.compare(before.pc, after.pc); if (pcSidecars.status !== "PASS") reasons.push("FLEET_PC_SIDECARS_CHANGED"); }
  else if (before.pc || after.pc) reasons.push("FLEET_PC_POLICY_CHANGED");
  const status = reasons.length === 0 ? "PASS" : reasons.length === 1 && auditRolled ? "INCONCLUSIVE" : "FAIL";
  return Object.freeze({ status, databaseBindingMatched, cohortAuthorityVerified, baselineCohortPreserved, fleetMetadataPreserved, identitiesPreserved, keysPreserved, workerLifecycleHistoryPreserved, auditRetainedHistoryPreserved, taskPayloadsPreserved, nonceProtectionPreserved, operationalChanges: Object.freeze({ fleet: changes(before.state.fleet, after.state.fleet), tasks: changes(before.state.tasks, after.state.tasks), nonces: before.nonces.filter((nonce) => !same(nonce, afterNonces.get(nonceKey(nonce)))).length + after.nonces.filter((nonce) => !before.nonces.some((old) => nonceKey(old) === nonceKey(nonce))).length, auditAppended: Math.max(0, newAudit.length - (auditRolled ? oldAudit.filter((event) => newAudit.some((next) => next.id === event.id)).length : oldAudit.length)), takeovers: changes(before.state.activeTakeovers, after.state.activeTakeovers) }), reasonCodes: Object.freeze(reasons), pcSidecars, coverage: pcSidecars ? Object.freeze({ ...COVERAGE, pcTaskSidecars: true, pcObservationSidecars: true, crossStoreAtomicity: false }) : COVERAGE });
}

const OUTPUT_PROFILE = 'goriq-guarded-preservation-data-v1';
const reject = () => { throw new Error('ROTATION_CUTOVER_GUARDED_PRESERVATION_DATA_REJECTED'); };
const wrap = value => frozenTree({profile: OUTPUT_PROFILE, nativeAuthority: false, actualCohortAuthorityVerified: false, freshnessVerified: false, effectCapability: false, ...value});
function project(wire) {
  try {
    requireValue(arguments.length === 1 && typeof wire === 'string' && wire.length <= 64 * 1024 * 1024 && Buffer.byteLength(wire) <= 64 * 1024 * 1024);
    const input = JSON.parse(wire);
    requireValue(JSON.stringify(input) === wire); jsonTree(input);
    requireValue(keys(input, ['profile', 'options', 'schema', 'file', 'stateRows', 'identityRows', 'nonceRows', 'pc', 'capturedAtMs'], ['profile', 'options', 'schema', 'file', 'stateRows', 'identityRows', 'nonceRows', 'pc', 'capturedAtMs']) && input.profile === 'goriq-guarded-preservation-rows-data-v1' && integer(input.capturedAtMs));
    const file = input.file;
    requireValue(keys(file, ['path', 'dev', 'ino', 'birthtime'], ['path', 'dev', 'ino', 'birthtime']) && string(file.path) && !file.path.includes('\0') && isAbsolute(file.path) && resolve(file.path) === file.path);
    for (const key of ['dev', 'ino', 'birthtime']) requireValue(typeof file[key] === 'string' && /^(?:0|[1-9][0-9]{0,39})$/.test(file[key]));
    const bound = boundOptions(file.path, input.options), schema = input.schema;
    requireValue(keys(schema, ['objects', 'userVersion', 'applicationId', 'tableList'], ['objects', 'userVersion', 'applicationId', 'tableList']) && schema.userVersion === 0 && schema.applicationId === 0 && Array.isArray(schema.objects) && schema.objects.length === Object.keys(SCHEMA).length);
    const names = new Set();
    for (const row of schema.objects) {
      requireValue(keys(row, ['type', 'name', 'tbl_name', 'sql'], ['type', 'name', 'tbl_name', 'sql']) && typeof row.name === 'string' && Object.hasOwn(SCHEMA, row.name) && !names.has(row.name)); names.add(row.name);
      const expected = SCHEMA[row.name];
      requireValue(row.type === expected.type && row.tbl_name === expected.table && normalizeSql(row.sql) === normalizeSql(expected.sql));
    }
    requireValue(Array.isArray(schema.tableList) && schema.tableList.length === 5); names.clear();
    for (const row of schema.tableList) {
      requireValue(keys(row, ['schema', 'name', 'type', 'ncol', 'wr', 'strict'], ['schema', 'name', 'type', 'ncol', 'wr', 'strict']) && typeof row.name === 'string' && !names.has(row.name)); names.add(row.name);
      const application = Object.hasOwn(TABLE_SQL, row.name);
      requireValue((application || ['sqlite_schema', 'sqlite_temp_schema'].includes(row.name)) && row.schema === (row.name === 'sqlite_temp_schema' ? 'temp' : 'main') && row.type === 'table' && row.ncol === (application ? 3 : 5) && row.wr === 0 && row.strict === (application ? 1 : 0));
    }
    requireValue(Array.isArray(input.stateRows) && input.stateRows.length === 1);
    const row = input.stateRows[0];
    requireValue(keys(row, ['id', 'payload', 'updated_at'], ['id', 'payload', 'updated_at']) && row.id === 1 && date(row.updated_at));
    const state = parsePayload(row.payload); validateState(state);
    requireValue(Array.isArray(input.identityRows) && input.identityRows.length <= 10000);
    let bytes = 0; names.clear();
    const identities = input.identityRows.map(identity => {
      requireValue(keys(identity, ['node_id', 'payload', 'updated_at'], ['node_id', 'payload', 'updated_at']) && typeof identity.payload === 'string' && !names.has(identity.node_id)); names.add(identity.node_id);
      bytes += Buffer.byteLength(identity.payload); requireValue(bytes <= MAX_JSON_BYTES);
      return validateIdentity(identity);
    });
    const identityMap = new Map(identities.map(identity => [identity.nodeId, identity]));
    requireValue(state.fleet.length === bound.authority.expectedCount && state.fleet.every(node => identityMap.has(node.id) && !identityMap.get(node.id).payload.revokedAt));
    if (bound.authority.kind === 'original-cohort-digest') requireValue(createHash('sha256').update(JSON.stringify(state.fleet.map(node => node.id).sort())).digest('hex') === bound.authority.cohortSha256);
    const nonces = input.nonceRows;
    requireValue(Array.isArray(nonces) && nonces.length <= 100000); names.clear();
    for (const nonce of nonces) {
      requireValue(keys(nonce, ['node_id', 'nonce', 'expires_at'], ['node_id', 'nonce', 'expires_at']) && string(nonce.node_id) && string(nonce.nonce) && integer(nonce.expires_at));
      const key = JSON.stringify([nonce.node_id, nonce.nonce]); requireValue(!names.has(key)); names.add(key);
    }
    requireValue(bound.pcSidecars ? input.pc !== null : input.pc === null);
    const sidecars = bound.pcSidecars ? pc.project(file.path, bound.pcSidecars, input.pc) : null;
    const handle = Object.freeze(Object.create(null));
    snapshots.set(handle, {state, identities, nonces, bound, file, pc: sidecars, capturedAt: input.capturedAtMs}); return handle;
  } catch { reject(); }
}
function summarize(handle) {
  try { requireValue(arguments.length === 1); return wrap({summary: fleetSnapshotSummary(handle)}); } catch { reject(); }
}
function compare(before, after) {
  try { requireValue(arguments.length === 2); return wrap({comparison: compareFleetSnapshots(before, after)}); } catch { reject(); }
}
const transitions = Object.freeze({
  initial: {'capture-before-cutover': 'captured'},
  captured: {'after-cutover': 'cutover-checked', 'after-rollback': 'restored'},
  'cutover-checked': {'before-rotation': 'baseline', 'after-rollback': 'restored'},
  baseline: {'before-commit': 'checked', 'after-rollback': 'restored'},
  checked: {'before-planned-restore': 'planned', 'after-planned-restore': 'planned-restored', 'after-rollback': 'restored'},
  planned: {'after-planned-restore': 'planned-restored'},
  restored: {}, 'planned-restored': {}, terminal: {}
});
function createObserver() {
  if (arguments.length !== 0) reject();
  const token = Object.freeze(Object.create(null)); observers.set(token, {phase: 'initial', baseline: null, summary: null, comparison: null}); return token;
}
function accept(token, event, snapshot) {
  let record, capture = false;
  try {
    requireValue(arguments.length === 3 && object(token) && (record = observers.get(token)) && typeof event === 'string' && Object.hasOwn(transitions[record.phase], event));
    requireValue(!['before-rotation', 'before-commit', 'before-planned-restore'].includes(event) || record.comparison?.status === 'PASS');
    capture = event === 'capture-before-cutover'; record.phase = transitions[record.phase][event]; record.comparison = null;
    requireValue(object(snapshot) && !owners.has(snapshot));
    const summary = fleetSnapshotSummary(snapshot); owners.set(snapshot, token);
    if (capture) {
      requireValue(record.baseline === null && summary.fleetCount === 38 && summary.schemaProfile === PROFILE && summary.pcSidecars?.profile === 'jarvis-pc-sidecars-v1' && compareFleetSnapshots(snapshot, snapshot).status === 'PASS');
      record.baseline = snapshot; record.summary = summary;
    } else { requireValue(record.baseline !== null); record.comparison = compareFleetSnapshots(record.baseline, snapshot); }
    return wrap({event, requiredClockPhase: ['after-rollback', 'after-planned-restore'].includes(event) ? 'RECOVERY' : 'FORWARD', accepted: capture || record.comparison.status === 'PASS', summary: record.summary, comparison: record.comparison});
  } catch { if (capture && record) record.phase = 'terminal'; reject(); }
}
return Object.freeze({project, summarize, compare, createObserver, accept});
})();

export const projectCutoverGuardedPreservationData = guardedPreservationData.project;
export const summarizeCutoverGuardedPreservationData = guardedPreservationData.summarize;
export const compareCutoverGuardedPreservationData = guardedPreservationData.compare;
export const createCutoverGuardedPreservationObserver = guardedPreservationData.createObserver;
export const acceptCutoverGuardedPreservationData = guardedPreservationData.accept;

const peerRowFields=['pid','parentPid','creationTicks','sessionId','imagePath','imageSha256','imageIdentityKey','ownerSidSha256','signatureStatus','publisher'];
const peerInt=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const peerTicks=value=>typeof value==='string'&&/^[1-9][0-9]{10,18}$/.test(value)&&BigInt(value)<=3155378975999999999n;
const peerPath=value=>typeof value==='string'&&/^[A-Za-z]:\\[^:\r\n\0]+$/.test(value)&&!value.includes('/')&&!value.substring(3).split('\\').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part));
export function validateCutoverPeerAncestryData(value,expected){
 try{
  if(!exact(value,['profile','effectCapability','helper','node','bootstrap'])||value.profile!=='goriq-owned-node-peer-ancestry-data-v1'||value.effectCapability!==false||!exact(expected,['nodePid','bootstrapPid','nodeCreationTicks','bootstrapCreationTicks','nodePath','systemPowerShellPath','ownerSidSha256','sessionId','nodeImageIdentityKey']))throw 0;
  if(!peerInt(expected.nodePid)||!peerInt(expected.bootstrapPid)||!peerTicks(expected.nodeCreationTicks)||!peerTicks(expected.bootstrapCreationTicks)||!peerPath(expected.nodePath)||!peerPath(expected.systemPowerShellPath)||!expected.systemPowerShellPath.toLowerCase().endsWith('\\system32\\windowspowershell\\v1.0\\powershell.exe')||typeof expected.ownerSidSha256!=='string'||!/^[a-f0-9]{64}$/.test(expected.ownerSidSha256)||!Number.isSafeInteger(expected.sessionId)||expected.sessionId<0||typeof expected.nodeImageIdentityKey!=='string'||!expected.nodeImageIdentityKey)throw 0;
  const rows=[value.helper,value.node,value.bootstrap];
  for(const [index,row] of rows.entries()){
   if(!exact(row,peerRowFields)||!peerInt(row.pid)||!peerInt(row.parentPid)||!peerTicks(row.creationTicks)||!Number.isSafeInteger(row.sessionId)||row.sessionId!==expected.sessionId||!peerPath(row.imagePath)||typeof row.imageSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.imageSha256)||row.ownerSidSha256!==expected.ownerSidSha256||typeof row.imageIdentityKey!=='string'||!row.imageIdentityKey||row.imageIdentityKey.length>512)throw 0;
   if(index===1){if(row.imagePath.toLowerCase()!==expected.nodePath.toLowerCase()||row.imageSha256!==cutoverNode.nodeSha256||row.signatureStatus!=='NOT_REQUIRED'||row.publisher!=='')throw 0;}
   else if(row.imagePath.toLowerCase()!==expected.systemPowerShellPath.toLowerCase()||row.signatureStatus!=='Valid'||row.publisher!=='Microsoft Corporation')throw 0;
   if(index>0&&BigInt(row.creationTicks)>BigInt(rows[index-1].creationTicks))throw 0;
  }
  if(new Set(rows.map(row=>row.pid)).size!==3||value.helper.parentPid!==value.node.pid||value.node.parentPid!==value.bootstrap.pid||value.node.pid!==expected.nodePid||value.bootstrap.pid!==expected.bootstrapPid||value.node.creationTicks!==expected.nodeCreationTicks||value.bootstrap.creationTicks!==expected.bootstrapCreationTicks||value.node.imageIdentityKey!==expected.nodeImageIdentityKey||value.helper.imageSha256!==value.bootstrap.imageSha256)throw 0;
  return frozenTree({...value});
 }catch{fail('ROTATION_CUTOVER_PEER_PROOF_REJECTED');}
}

const peerHelloFields=['schemaVersion','kind','sequence','sourceRevision','originalGrantSha256','attemptId','workflowRunId','officialJobId','nativeMjsSha256','nativePsSha256','bootstrapPid','bootstrapCreationTicks','ownerSidSha256','sessionId','nodePid','nodeCreationTicks','nodePath','nodeImageIdentityKey'];
// DATA only; the original PS must still own and verify its real Process/channel.
export function validateCutoverPeerHelloData(value,self){
 try{
  if(!exact(value,peerHelloFields)||!exact(self,['pid','parentPid','nodePath','nodeSha256','nativeMjsSha256','nativePsSha256'])||value.schemaVersion!==1||value.kind!=='GORIQ_OWNED_NODE_PEER_HELLO'||value.sequence!==1||!peerInt(value.nodePid)||!peerInt(value.bootstrapPid)||!peerTicks(value.nodeCreationTicks)||!peerTicks(value.bootstrapCreationTicks)||BigInt(value.bootstrapCreationTicks)>BigInt(value.nodeCreationTicks)||!Number.isSafeInteger(value.sessionId)||value.sessionId<=0||!peerPath(value.nodePath))throw 0;
  for(const name of ['originalGrantSha256','nativeMjsSha256','nativePsSha256','ownerSidSha256'])if(typeof value[name]!=='string'||!/^[a-f0-9]{64}$/.test(value[name]))throw 0;
  if(typeof value.sourceRevision!=='string'||!/^[a-f0-9]{40}$/.test(value.sourceRevision)||typeof value.attemptId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.attemptId)||['workflowRunId','officialJobId'].some(name=>typeof value[name]!=='string'||!/^[1-9][0-9]{0,19}$/.test(value[name]))||typeof value.nodeImageIdentityKey!=='string'||!value.nodeImageIdentityKey||value.nodeImageIdentityKey.length>512||/[\r\n\0]/.test(value.nodeImageIdentityKey))throw 0;
  if(value.nodePid!==self.pid||value.bootstrapPid!==self.parentPid||typeof self.nodePath!=='string'||value.nodePath.toLowerCase()!==self.nodePath.toLowerCase()||self.nodeSha256!==cutoverNode.nodeSha256||value.nativeMjsSha256!==self.nativeMjsSha256||value.nativePsSha256!==self.nativePsSha256)throw 0;
  return frozenTree({effectCapability:false,hello:{...value}});
 }catch{fail('ROTATION_CUTOVER_PEER_PROOF_REJECTED');}
}
// Fixed private owned-peer clock DATA; never exported as an authority/API.
const peerClockEndpointFields=['schemaVersion','profile','sourceRevision','originalGrantSha256','workflowRunId','officialJobId','originUtcTicks','originStamp','frequency','sampleUtcTicks','sampleStamp','hardEndUtcTicks','hardStampEndpoint','forwardStampEndpoint','remainingHardTicks','remainingForwardTicks','nativeAuthority','effectCapability','qpcAssociationVerified'];
function cutoverPeerClockBinding(hello){
 const binding={sourceRevision:hello.sourceRevision,originalGrantSha256:hello.originalGrantSha256,attemptId:hello.attemptId,workflowRunId:hello.workflowRunId,officialJobId:hello.officialJobId,parentPid:hello.bootstrapPid,parentCreationTicks:hello.bootstrapCreationTicks,nodePid:hello.nodePid,nodeCreationTicks:hello.nodeCreationTicks,ownerSidSha256:hello.ownerSidSha256,sessionId:hello.sessionId,nodeImageSha256:cutoverNode.nodeSha256,nativeMjsSha256:hello.nativeMjsSha256,nativePsSha256:hello.nativePsSha256};cutoverQpcBinding(binding);return frozenTree(binding);
}
function cutoverPeerClockProjection(endpoint,binding,initial=null,previous=null){
 if(!exact(endpoint,peerClockEndpointFields)||endpoint.schemaVersion!==1||endpoint.profile!=='goriq-original-clock-endpoints-data-v1'||endpoint.nativeAuthority!==false||endpoint.effectCapability!==false||endpoint.qpcAssociationVerified!==false||['sourceRevision','originalGrantSha256','workflowRunId','officialJobId'].some(k=>endpoint[k]!==binding[k]))throw 0;
 const n={};for(const k of ['originUtcTicks','sampleUtcTicks','hardEndUtcTicks'])n[k]=cutoverDecimal(endpoint[k],3155378975999999999n,true);for(const k of ['originStamp','sampleStamp','hardStampEndpoint','forwardStampEndpoint','remainingHardTicks','remainingForwardTicks'])n[k]=cutoverDecimal(endpoint[k],cutoverSigned64Max,true);const f=cutoverDecimal(endpoint.frequency,cutoverSigned64Max),o=n.originStamp,h=n.hardStampEndpoint,s=n.sampleStamp,H=n.hardEndUtcTicks,Fms=H/10000n,r=H-10000n*Fms,reserve=120n*f;
 if(n.sampleUtcTicks<n.originUtcTicks||H<=n.sampleUtcTicks||H<=n.originUtcTicks||H-n.originUtcTicks>9000000000n||s<o||h<=s||h>o+(H-n.originUtcTicks)*f/10000000n||n.forwardStampEndpoint!==(h>reserve?h-reserve:0n)||n.remainingHardTicks!==h-s||n.remainingForwardTicks!==(n.forwardStampEndpoint>s?n.forwardStampEndpoint-s:0n))throw 0;
 let hard=h-(r*f+9999999n)/10000000n;
 if(initial!==null||previous!==null){if(!initial||!previous||initial.originUtcTicks!==endpoint.originUtcTicks||previous.originUtcTicks!==initial.originUtcTicks||H>BigInt(previous.hardEndUtcTicks)||BigInt(previous.hardEndUtcTicks)>BigInt(initial.hardEndUtcTicks)||initial.originQpc!==endpoint.originStamp||initial.frequencyQpc!==endpoint.frequency||previous.originQpc!==initial.originQpc||previous.frequencyQpc!==initial.frequencyQpc||Fms>BigInt(previous.fms)||BigInt(previous.hardQpc)>BigInt(initial.hardQpc))throw 0;const cap=BigInt(initial.hardQpc)-((BigInt(initial.fms)-Fms)*f+999n)/1000n;hard=hard<BigInt(previous.hardQpc)?hard:BigInt(previous.hardQpc);hard=hard<cap?hard:cap;}
 if(hard<=s||hard<0n||hard>cutoverSigned64Max)throw 0;
 // Only the final exact calendar serialization uses Number, never a budget.
 const hardEndUtc=new Date(Number(Fms-62135596800000n)).toISOString();if(cutoverUtc(hardEndUtc)!==Fms)throw 0;
 const forward=hard>reserve?hard-reserve:0n;
 if(initial===null&&(hard<=o+reserve||forward===0n))throw 0;
 return frozenTree({originUtcTicks:endpoint.originUtcTicks,hardEndUtcTicks:endpoint.hardEndUtcTicks,originQpc:endpoint.originStamp,frequencyQpc:endpoint.frequency,hardQpc:String(hard),forwardQpc:String(forward),hardEndUtc,fms:String(Fms)});
}
function cutoverPeerClockData(frame,binding,initial,hrBefore,hrAfter){
 if(!exact(frame,['schemaVersion','kind','sequence','binding','endpoint','qpcBefore','qpcAfter','frequencyQpc','stopwatchFrequency','stopwatchHighResolution'])||frame.schemaVersion!==1||frame.kind!=='GORIQ_OWNED_NODE_PEER_CLOCK_DATA'||frame.sequence!==4)throw 0;
 cutoverQpcBinding(frame.binding);if(qpcBindingFields.some(k=>frame.binding[k]!==binding[k]))throw 0;
 const current=cutoverPeerClockProjection(frame.endpoint,binding,initial,initial);
 return validateCutoverOriginalQpcData({profile:'goriq-original-qpc-association-data-v1',platform:process.platform,architecture:process.arch,nodeVersion:process.versions.node,binding:frame.binding,frequencyQpc:frame.frequencyQpc,stopwatchFrequency:frame.stopwatchFrequency,stopwatchHighResolution:frame.stopwatchHighResolution,nodeHrBefore:hrBefore,nodeHrAfter:hrAfter,qpcBefore:frame.qpcBefore,stopwatchSample:frame.endpoint.sampleStamp,qpcAfter:frame.qpcAfter,originQpc:current.originQpc,forwardQpc:current.forwardQpc,hardQpc:current.hardQpc,hardEndUtc:current.hardEndUtc,originalClockState:'VALID'},{binding,originQpc:initial.originQpc,frequencyQpc:initial.frequencyQpc,originalForwardQpc:initial.forwardQpc,originalHardQpc:initial.hardQpc,originalHardEndUtc:initial.hardEndUtc,previousForwardQpc:initial.forwardQpc,previousHardQpc:initial.hardQpc,previousHardEndUtc:initial.hardEndUtc,previousNodeHrtime:'0'});
}
function ownedPeerMetadataEnvironment(){
 const env={};for(const name of cleanPlatformFields){const value=process.env[name];if(typeof value!=='string'||!value||/[\r\n\0]/.test(value))fail('ROTATION_CUTOVER_PEER_PROOF_REJECTED');env[name]=value;}env.WINDIR=env.SystemRoot;return env;
}
async function runOwnedCutoverPeer(){
 let helper=null;
 try{
  if(process.platform!=='win32'||process.arch!=='x64'||process.versions.node!=='24.19.0')throw 0;
  const nativePath=join(root,'scripts','owner-code-rotation-native-1218.ps1'),mjsPath=fileURLToPath(import.meta.url),env=ownedPeerMetadataEnvironment(),shell=win32.join(env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  if(!peerPath(shell))throw 0;
  const self={pid:process.pid,parentPid:process.ppid,nodePath:process.execPath,nodeSha256:hash(regular(process.execPath,134217728)),nativeMjsSha256:hash(regular(mjsPath)),nativePsSha256:hash(regular(nativePath,262144))};
  await new Promise((resolve,reject)=>{
   let input=Buffer.alloc(0),phase='HELLO',settled=false,clockBinding=null,clockInitial=null,clockHrBefore=null;
   const stop=()=>{if(helper){try{helper.kill();}catch{}}};
   const refuse=()=>{if(settled)return;settled=true;stop();reject(new Error('ROTATION_CUTOVER_PEER_PROOF_REJECTED'));};
   process.stdin.on('error',refuse);process.stdin.on('end',refuse);
   process.stdin.on('data',chunk=>{
    if(settled)return;if(!['HELLO','AWAIT_ARM','AWAIT_DATA'].includes(phase)){refuse();return;}
    input=Buffer.concat([input,chunk]);if(input.length>32768){refuse();return;}const end=input.indexOf(10);if(end<0)return;if(end!==input.length-1){refuse();return;}
    const enteredPhase=phase,clockHrAfter=enteredPhase==='AWAIT_DATA'?process.hrtime.bigint():null;phase='PROCESSING';
    void (async()=>{
     let frame=input.subarray(0,end);if(frame.length&&frame.at(-1)===13)frame=frame.subarray(0,-1);if(frame.subarray(0,3).equals(Buffer.from([239,187,191]))){if(enteredPhase!=='HELLO')throw 0;frame=frame.subarray(3);}input=Buffer.alloc(0);
     if(enteredPhase==='AWAIT_ARM'){
      const arm=proofMetadata(frame);if(!exact(arm,['schemaVersion','kind','sequence','binding','endpoint'])||arm.schemaVersion!==1||arm.kind!=='GORIQ_OWNED_NODE_PEER_CLOCK_ARM'||arm.sequence!==2)throw 0;cutoverQpcBinding(arm.binding);if(qpcBindingFields.some(k=>arm.binding[k]!==clockBinding[k]))throw 0;clockInitial=cutoverPeerClockProjection(arm.endpoint,clockBinding);
      const request=JSON.stringify({schemaVersion:1,kind:'GORIQ_OWNED_NODE_PEER_CLOCK_REQUEST',sequence:3,binding:clockBinding})+'\n';if(Buffer.byteLength(request)>32768)throw 0;
      phase='AWAIT_DATA';clockHrBefore=process.hrtime.bigint();await new Promise((done,failed)=>process.stdout.write(request,error=>error?failed(error):done()));return;
     }
     if(enteredPhase==='AWAIT_DATA'){
      const data=proofMetadata(frame);cutoverPeerClockData(data,clockBinding,clockInitial,String(clockHrBefore),String(clockHrAfter));
      const ack=JSON.stringify({schemaVersion:1,kind:'GORIQ_OWNED_NODE_PEER_CLOCK_ACK',sequence:5,binding:clockBinding,dataSha256:hash(frame),nodeHrBefore:String(clockHrBefore),nodeHrAfter:String(clockHrAfter),associationDataMatched:true,nativeAuthority:false,originalClockAuthorityVerified:false})+'\n';if(Buffer.byteLength(ack)>32768)throw 0;phase='HELD';await new Promise((done,failed)=>process.stdout.write(ack,error=>error?failed(error):done()));return;
     }
     const hello=validateCutoverPeerHelloData(proofMetadata(frame),self).hello;clockBinding=cutoverPeerClockBinding(hello);
     const quote=value=>"'"+value.replaceAll("'","''")+"'";
     // Fixed readonly leaf; retain and execute the exact authenticated bytes.
     const capsule="$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;$p="+quote(nativePath)+";$h="+quote(self.nativePsSha256)+";$s=$null;try{$s=[IO.File]::OpenRead($p);if($s.Length -lt 1 -or $s.Length -gt 262144){throw 'PEER_SOURCE'};$b=[byte[]]::new([int]$s.Length);$n=0;while($n -lt $b.Length){$c=$s.Read($b,$n,$b.Length-$n);if($c -le 0){throw 'PEER_SOURCE'};$n+=$c};$sha=[Security.Cryptography.SHA256]::Create();try{$d=([BitConverter]::ToString($sha.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};if($d -cne $h){throw 'PEER_SOURCE'};.([scriptblock]::Create(([Text.UTF8Encoding]::new($false,$true)).GetString($b)));$r=Get-OwnerCutoverPeerAncestryData;[Console]::Out.WriteLine(($r|Microsoft.PowerShell.Utility\\ConvertTo-Json -Depth 5 -Compress))}catch{exit 1}finally{if($s){$s.Dispose()}}";
     const ancestry=await new Promise((done,failed)=>{
      let output=Buffer.alloc(0),problem=false,ended=false;
      const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);if(error)failed(new Error('ROTATION_CUTOVER_PEER_PROOF_REJECTED'));else done(value);};
      const timer=setTimeout(()=>{problem=true;try{helper?.kill();}catch{}finish(true);},12000);
      try{helper=spawn(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(capsule,'utf16le').toString('base64')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env});helper.stdout.on('data',data=>{if(output.length+data.length>32768){problem=true;try{helper.kill();}catch{}}else output=Buffer.concat([output,data]);});helper.stderr.on('data',()=>{problem=true;try{helper.kill();}catch{}});helper.on('error',()=>finish(true));helper.on('close',exit=>{if(problem||exit!==0){finish(true);return;}try{let bytes=output;if(bytes.subarray(0,3).equals(Buffer.from([239,187,191])))bytes=bytes.subarray(3);if(bytes.at(-1)===10){bytes=bytes.subarray(0,-1);if(bytes.at(-1)===13)bytes=bytes.subarray(0,-1);}const expected={nodePid:hello.nodePid,bootstrapPid:hello.bootstrapPid,nodeCreationTicks:hello.nodeCreationTicks,bootstrapCreationTicks:hello.bootstrapCreationTicks,nodePath:hello.nodePath,systemPowerShellPath:shell,ownerSidSha256:hello.ownerSidSha256,sessionId:hello.sessionId,nodeImageIdentityKey:hello.nodeImageIdentityKey};finish(false,validateCutoverPeerAncestryData(proofMetadata(bytes),expected));}catch{finish(true);}});}catch{finish(true);}
     });
     if(settled)throw 0;
     const reply={schemaVersion:1,kind:'GORIQ_OWNED_NODE_PEER_OS_DATA',sequence:1,sourceRevision:hello.sourceRevision,originalGrantSha256:hello.originalGrantSha256,nativeMjsSha256:hello.nativeMjsSha256,nativePsSha256:hello.nativePsSha256,ancestry};const wire=JSON.stringify(reply)+'\n';if(Buffer.byteLength(wire)>32768)throw 0;
     phase='AWAIT_ARM';await new Promise((done,failed)=>process.stdout.write(wire,error=>error?failed(error):done()));
     // Optional fixed private DATA transaction only; all other commands refuse.
    })().catch(refuse);
   });
  });
 }catch{fail('ROTATION_CUTOVER_PEER_PROOF_REJECTED');}finally{if(helper)try{helper.kill();}catch{}}
}

export const ROTATION_PUBLIC_SOURCE_FILES=Object.freeze([...ROTATION_SOURCE_FILES,'scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1']);
const publicFlags=['credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval'];
const grantFields=['schemaVersion','kind','scopeId','issue','goalId','authorityType','issuedBy','approvalId','approvalReference','sourceRevision','sourceHashes','ciRunId','ciRunAttempt','workflowPath','ownerSidSha256','profile','operation','issuedAt','expiresAt','maxAttempts','maxDurationSeconds','recoveryReserveSeconds','cohortAuthority','pcSidecars',...publicFlags];
export function compilePublicRotationGrant(encoded,environment=process.env,now=Date.now()){
 const g=decodeRotationEntryDescriptor(encoded);
 if(grantFields.filter(k=>!['schemaVersion','issue','sourceHashes','ciRunAttempt','maxAttempts','maxDurationSeconds','recoveryReserveSeconds','cohortAuthority','pcSidecars',...publicFlags].includes(k)).some(k=>typeof g[k]!=='string'))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 const issued=Date.parse(g.issuedAt),expires=Date.parse(g.expiresAt);
 if(!exact(g,grantFields)||g.schemaVersion!==1||g.kind!=='NONSECRET_ORIGINAL_ROTATION_GRANT'||g.scopeId!=='issue:1218:owner-code-rotation'||g.issue!==1218||g.goalId!=='goal-fcc81c97e09153f7'||g.authorityType!=='FRESH_OWNER_HIGH_ROTATION_RESTORATION_APPROVAL'||g.issuedBy!=='owner-approved-task-operator'||g.profile!=='jarvis-owner-production-v1'||g.operation!=='rotate-verify-restore-verify-original'||g.maxAttempts!==1||g.maxDurationSeconds!==900||g.recoveryReserveSeconds!==120||publicFlags.some(f=>g[f]!==true))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(g.approvalId)||!/^owner-approval:[a-f0-9]{64}$/.test(g.approvalReference)||!/^[a-f0-9]{40}$/.test(g.sourceRevision)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(g.issuedAt)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(g.expiresAt)||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires-now<900000||expires-issued>7200000||expires>Date.parse('2026-11-10T08:00:00Z')||!/^owner-approval:/.test(g.approvalReference)||!/^[1-9]\d{0,19}$/.test(g.ciRunId)||g.ciRunAttempt!==1||g.workflowPath!=='.github/workflows/gai-zbook-diagnostic-1218.yml'||!/^[a-f0-9]{64}$/.test(g.ownerSidSha256))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(!exact(g.sourceHashes,ROTATION_PUBLIC_SOURCE_FILES)||Object.values(g.sourceHashes).some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))||!exact(g.cohortAuthority,['kind','expectedCount'])||g.cohortAuthority.kind!=='approved-active-capture'||g.cohortAuthority.expectedCount!==38||!exact(g.pcSidecars,['profile','expectedTaskFile','expectedObservationFile'])||g.pcSidecars.profile!=='jarvis-pc-sidecars-v1'||!['present','absent'].includes(g.pcSidecars.expectedTaskFile)||!['present','absent'].includes(g.pcSidecars.expectedObservationFile))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(environment.GITHUB_ACTOR!=='haji84'||environment.GITHUB_REPOSITORY!=='haji84/AI-'||environment.GITHUB_REF!=='refs/heads/main'||environment.GITHUB_SHA!==g.sourceRevision||!/^[1-9]\d{0,19}$/.test(environment.GITHUB_RUN_ID)||environment.GITHUB_RUN_ATTEMPT!=='1'||environment.GITHUB_WORKFLOW_REF!=='haji84/AI-/'+g.workflowPath+'@refs/heads/main'||environment.JARVIS_PRODUCTION_CONFIG)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 return {grant:g,originalGrantSha256:hash(JSON.stringify(g))};
}

// Source40 data boundary only. These records and clocks never grant a native
// capability; official proof/source and OS admission must precede live wiring.
export const ROTATION_CUTOVER_PUBLIC_SOURCE_FILES=Object.freeze([...ROTATION_PUBLIC_SOURCE_FILES,'scripts/owner-code-production-cutover-1218.ps1']);
const cutoverData=new WeakMap(),cutoverClocks=new WeakMap(),clockOwners=new WeakSet(),allocatedClocks=new Map();
const proofFlags=['explicitOwnerApproval','createEphemeralAccountApproval','temporaryPasswordPersistenceApproval','temporaryTaskRegistrationApproval','conditionalBatchLogonRightApproval','ownObjectCleanupApproval'];
const proofKeys=['schemaVersion','scopeId','goalId','sourceRevision','scriptSha256','issuedAt','expiresAt','attemptId','runBinding','maxAttempts','maxAccounts','maxTasks','maxJobs','maxDurationSeconds','cleanupReserveSeconds','maxTotalSeconds',...proofFlags];
const cutoverNode={approved:true,version:'24.19.0',architecture:'x64',archiveSha256:'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73',nodeSha256:'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237',signerCertificateSha256:'c5b94f1334367cb4fa004504d0cb62a558d30e1c3c712f729a02333bf5011522',publisher:'OpenJS Foundation',retention:'while-referenced'};
const cutoverEnvironment=['GITHUB_ACTOR','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW_REF'];
function frozenTree(value){if(object(value)||Array.isArray(value)){for(const child of Object.values(value))frozenTree(child);Object.freeze(value);}return value;}
function cutoverBytes(encoded,maximum){
 if(typeof encoded!=='string'||encoded.length>4*Math.ceil(maximum/3)||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>maximum||bytes.toString('base64')!==encoded)fail('ROTATION_CUTOVER_SCOPE_REQUIRED');return bytes;
}
function cutoverJson(bytes){
 try{const wire=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(wire);if(!object(value)||JSON.stringify(value)!==wire)fail('ROTATION_CUTOVER_SCOPE_REQUIRED');return value;}catch{fail('ROTATION_CUTOVER_SCOPE_REQUIRED');}
}
function cutoverIso(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function cutoverProofApproval(encoded){
 const a=cutoverJson(cutoverBytes(encoded,1024));
 if(!exact(a,proofKeys)||a.schemaVersion!==2||a.scopeId!=='issue:1218:ephemeral-password-task-retention-proof'||a.goalId!=='goal-fcc81c97e09153f7'||typeof a.sourceRevision!=='string'||!/^[a-f0-9]{40}$/.test(a.sourceRevision)||a.scriptSha256!=='1698f5238d2ca735dee2cfad7c5ed1238f396866220aeebf3624bab560edecca'||!cutoverIso(a.issuedAt)||!cutoverIso(a.expiresAt)||Date.parse(a.expiresAt)-Date.parse(a.issuedAt)<600000||Date.parse(a.expiresAt)-Date.parse(a.issuedAt)>7200000||typeof a.attemptId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.attemptId)||a.runBinding!=='one-current-dispatch-attempt-1'||['maxAttempts','maxAccounts','maxTasks','maxJobs'].some(k=>a[k]!==1)||a.maxDurationSeconds!==480||a.cleanupReserveSeconds!==120||a.maxTotalSeconds!==600||proofFlags.some(k=>a[k]!==true))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 return a;
}
export function compilePublicCutoverGrant(encoded,environment=process.env,now=Date.now()){
 const bytes=cutoverBytes(encoded,32768),g=cutoverJson(bytes);
 if(!exact(g,[...grantFields,'taskActionMigration','knownRecoveryTask','protectedNodeBootstrap','credentialProof'])||g.schemaVersion!==2||g.profile!=='jarvis-owner-production-cutover-v1'||g.operation!=='cutover-rotate-verify-restore-verify-original'||!cutoverIso(g.issuedAt)||!cutoverIso(g.expiresAt)||!exact(g.sourceHashes,ROTATION_CUTOVER_PUBLIC_SOURCE_FILES)||Object.values(g.sourceHashes).some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 // Reuse only common validation. This projection is never returned/transported
 // as a v1 authority, and its hash is never substituted for the original wire.
 const common=Object.fromEntries(grantFields.map(k=>[k,g[k]]));common.schemaVersion=1;common.profile='jarvis-owner-production-v1';common.operation='rotate-verify-restore-verify-original';common.sourceHashes=Object.fromEntries(ROTATION_PUBLIC_SOURCE_FILES.map(k=>[k,g.sourceHashes[k]]));
 compilePublicRotationGrant(Buffer.from(JSON.stringify(common)).toString('base64'),environment,now);
 const task=g.taskActionMigration,recovery=g.knownRecoveryTask,proof=g.credentialProof;
 if(!exact(task,['approved','taskName','taskPath','target'])||task.approved!==true||task.taskName!=='JARVIS Remote Host'||task.taskPath!=='\\'||task.target!=='bound-direct-node'||!exact(recovery,['approved','profile','maxTasks','allowedOperations','disposition'])||recovery.approved!==true||recovery.profile!=='interactive-owner-limited-manual-v1'||recovery.maxTasks!==1||!Array.isArray(recovery.allowedOperations)||JSON.stringify(recovery.allowedOperations)!=='["preflight","recover-known-runtime"]'||recovery.disposition!=='retain-until-password-primary-healthy'||!exact(g.protectedNodeBootstrap,Object.keys(cutoverNode))||Object.entries(cutoverNode).some(([k,v])=>g.protectedNodeBootstrap[k]!==v))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 if(!exact(proof,['runId','jobId','artifactId','approvalBase64','archiveBase64','dispatchLedgerSha256','independentVerdictSha256'])||['runId','jobId','artifactId'].some(k=>typeof proof[k]!=='string'||!/^[1-9]\d{0,19}$/.test(proof[k]))||['dispatchLedgerSha256','independentVerdictSha256'].some(k=>typeof proof[k]!=='string'||!/^[a-f0-9]{64}$/.test(proof[k])))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 const approval=cutoverProofApproval(proof.approvalBase64),archive=cutoverBytes(proof.archiveBase64,16384);
 if(archive.length<22||archive.readUInt32LE(0)!==0x04034b50)fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 const result=frozenTree({grant:g,originalGrantSha256:hash(bytes),proofApproval:approval,proofArchiveSha256:hash(archive),effectCapability:false});
 cutoverData.set(result,{environment:Object.fromEntries(cutoverEnvironment.map(k=>[k,environment[k]]))});return result;
}
export function createCutoverClock(data,jobs,environment=process.env,{utcClock=Date.now,monoClock=()=>performance.now()}={}){
 const record=cutoverData.get(data);if(!record||clockOwners.has(data)||cutoverEnvironment.some(k=>environment[k]!==record.environment[k])||environment.JARVIS_PRODUCTION_CONFIG)fail('ROTATION_CUTOVER_CLOCK_REQUIRED');
 const utc=utcClock(),mono=monoClock();if(!Number.isFinite(utc)||!Number.isFinite(mono)||mono<0)fail('ROTATION_CUTOVER_CLOCK_INVALID');
 const jobHard=validateAllocatedRotationJob(jobs,data.grant,environment,utc),job=jobs.jobs.find(j=>j.name==='inspect');
 const allocation=JSON.stringify([environment.GITHUB_REPOSITORY,environment.GITHUB_WORKFLOW_REF,environment.GITHUB_RUN_ID,environment.GITHUB_RUN_ATTEMPT,'inspect']),original=allocatedClocks.get(allocation);
 if(original){
  if(original.grantSha256!==data.originalGrantSha256||original.jobId!==job.id||original.jobStartedAt!==job.started_at)fail('ROTATION_CUTOVER_CLOCK_REQUIRED');
  // Exact recompilation may retrieve only the original token/callbacks. In
  // particular a stalled UTC clock cannot issue a fresh monotonic anchor.
  observeCutoverClock(original.token,'Recovery');clockOwners.add(data);return original.token;
 }
 const hardEnd=Math.min(Date.parse(job.started_at)+900000,Date.parse(data.grant.expiresAt),jobHard);
 if(hardEnd-utc<=120000)fail('ROTATION_CUTOVER_FORWARD_RESERVE');
 const token=Object.freeze({});cutoverClocks.set(token,{utcClock,monoClock,lastUtc:utc,lastMono:mono,hardEnd,hardMono:mono+(hardEnd-utc),terminal:null});clockOwners.add(data);allocatedClocks.set(allocation,{token,grantSha256:data.originalGrantSha256,jobId:job.id,jobStartedAt:job.started_at});return token;
}
export function observeCutoverClock(token,phase,minimumRemainingMs=0){
 const c=cutoverClocks.get(token);if(!c||!['Forward','Recovery'].includes(phase)||!Number.isFinite(minimumRemainingMs)||minimumRemainingMs<0)fail('ROTATION_CUTOVER_CLOCK_REQUIRED');
 if(c.terminal)fail(c.terminal);
 const utc=c.utcClock(),mono=c.monoClock();
 if(!Number.isFinite(utc)||!Number.isFinite(mono)||utc<c.lastUtc||mono<c.lastMono){c.terminal='ROTATION_CUTOVER_CLOCK_INVALID';fail(c.terminal);}
 c.lastUtc=utc;c.lastMono=mono;
 const hardRemaining=Math.min(c.hardEnd-utc,c.hardMono-mono),forwardRemaining=hardRemaining-120000;
 if(hardRemaining<=0){c.terminal='ROTATION_CUTOVER_DEADLINE';fail(c.terminal);}
 if((phase==='Forward'?forwardRemaining:hardRemaining)<=minimumRemainingMs)fail('ROTATION_CUTOVER_FORWARD_RESERVE');
 return Object.freeze({hardEndUtc:new Date(c.hardEnd).toISOString(),forwardEndUtc:new Date(c.hardEnd-120000).toISOString(),remainingHardMs:hardRemaining,remainingForwardMs:Math.max(0,forwardRemaining)});
}

const credentialProofData=new WeakMap();
const credentialProofScript='1698f5238d2ca735dee2cfad7c5ed1238f396866220aeebf3624bab560edecca',credentialProofWorkflow='a56f91a0b2637b7b618fa32f3a0ccf373b4d69ee3a47bc9c31bbcfe1814da071';
const proofTrue=['validationAccepted','accountCreated','taskCreated','baselineRan','changedRan','restoredRan','actualAccountSidMatched','passwordLogonPreserved','limitedPrincipalPreserved','nonActionDefinitionPreserved','taskSecurityPreserved','actionRestored','updateOmittedUserAndPassword','restoreOmittedUserAndPassword','allThreeActionFieldsChanged','taskRemoved','accountRemoved','ownProfileRemovedOrAbsent','ownBatchRightRemovedOrAbsent','ownFilesRemoved','cleanupVerified','deadlineBudgetAdmitted','forwardCompleted','finalDeadlineValid'];
const proofFalse=['existingTaskTouched','productionTouched','forwardDeadlineExceeded','cleanupDeadlineExceeded','hardDeadlineExceeded','credentialValueEmitted','rawIdentityOrPathEmitted'];
const proofResultKeys=['schemaVersion','issue','operation','complete','mode','failureCode','failedStage','cleanupFailureCode','sourceRevision','scriptSha256','approvalSha256','runId','runAttempt','attemptId','validationAccepted','accountCreated','taskCreated','conditionalBatchRightAdded','baselineRan','changedRan','restoredRan','actualAccountSidMatched','passwordLogonPreserved','limitedPrincipalPreserved','nonActionDefinitionPreserved','taskSecurityPreserved','actionRestored','updateOmittedUserAndPassword','restoreOmittedUserAndPassword','allThreeActionFieldsChanged','windowsBuild','taskRemoved','accountRemoved','ownProfileRemovedOrAbsent','ownBatchRightRemovedOrAbsent','ownFilesRemoved','cleanupVerified','existingTaskTouched','productionTouched','deadlineBudgetAdmitted','forwardCompleted','finalDeadlineValid','forwardDeadlineExceeded','cleanupDeadlineExceeded','hardDeadlineExceeded','credentialValueEmitted','rawIdentityOrPathEmitted','nativeZBookAcceptanceCredit','diagnostics'];
const proofComponents=['FORWARD','TASK','ACCOUNT_DISABLE','BATCH_RIGHT','PROFILE','ACCOUNT_REMOVE','FILES','NONE'];
function proofNeed(condition){if(!condition)fail('ROTATION_CUTOVER_PROOF_REJECTED');}
function proofInteger(value,minimum,maximum){return Number.isSafeInteger(value)&&value>=minimum&&value<=maximum;}
function proofFault(value){
 if(value===null)return true;
 const domains={component:proofComponents,operation:['TASK_ACTION_UPDATE','TASK_ACTION_RESTORE','PROFILE_QUERY','PROFILE_REMOVE','PROFILE_READBACK','OTHER'],origin:['PRE_GUARD','CALL_THROW','POST_GUARD','SOURCE_REFUSAL','UNKNOWN'],callState:['NOT_ENTERED','THREW','RETURNED','NOT_APPLICABLE','UNKNOWN'],exceptionKind:['NONE','CIM','WIN32','COM','POWERSHELL','DOTNET','UNKNOWN']},numbers=['hresult','win32NativeCode','cimNativeCode','cimStatusCode','cimProviderErrorCode'];
 return exact(value,[...Object.keys(domains),...numbers])&&Object.entries(domains).every(([key,allowed])=>typeof value[key]==='string'&&allowed.includes(value[key]))&&numbers.every(key=>value[key]===null||proofInteger(value[key],key==='hresult'?-2147483648:0,key==='hresult'?2147483647:4294967295));
}
function proofResult(value){
 const failures=['PROOF_MODE_REQUIRED','PROOF_APPROVAL_REQUIRED','PROOF_CONTEXT_REQUIRED','PROOF_HOSTED_WINDOWS_REQUIRED','PROOF_HOSTED_ADMIN_REQUIRED','PROOF_OWN_OBJECT_COLLISION','PROOF_ACCOUNT_BOUNDARY_CHANGED','PROOF_BATCH_LOGON_REFUSED','PROOF_TASK_BOUNDARY_CHANGED','PROOF_EXECUTION_FAILED','PROOF_ACCOUNT_EXECUTION_MISMATCH','PROOF_JOB_BUDGET_REQUIRED','PROOF_CLOCK_INVALID','PROOF_HARD_DEADLINE','PROOF_FORWARD_DEADLINE','PROOF_FORWARD_RESERVE','PROOF_CLEANUP_DEADLINE','PROOF_CLEANUP_NOT_STARTED','PROOF_CLEANUP_FAILED','PROOF_OPERATION_FAILED'];
 const stages=['approval','platform','native-callback','account','batch-right','own-files','registration','baseline','action-update','changed-execution','action-restore','restored-execution','cleanup','final-deadline'];
 proofNeed(exact(value,proofResultKeys)&&value.schemaVersion===3&&value.issue===1218&&value.runAttempt===1&&value.nativeZBookAcceptanceCredit===0&&value.operation==='ephemeral-password-task-retention-proof'&&value.mode==='APPLY');
 proofNeed(['schemaVersion','issue','runAttempt','nativeZBookAcceptanceCredit'].every(k=>Number.isSafeInteger(value[k]))&&['complete','conditionalBatchRightAdded',...proofTrue,...proofFalse].every(k=>typeof value[k]==='boolean'));
 proofNeed(['sourceRevision','scriptSha256','approvalSha256'].every(k=>typeof value[k]==='string'&&new RegExp('^[a-f0-9]{'+(k==='sourceRevision'?40:64)+'}$').test(value[k]))&&typeof value.runId==='string'&&/^[1-9]\d{0,19}$/.test(value.runId)&&typeof value.attemptId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.attemptId)&&typeof value.windowsBuild==='string'&&/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value.windowsBuild));
 proofNeed(['failureCode','cleanupFailureCode'].every(k=>value[k]===null||typeof value[k]==='string'&&failures.includes(value[k]))&&(value.failedStage===null||typeof value.failedStage==='string'&&stages.includes(value.failedStage)));
 const d=value.diagnostics;proofNeed(exact(d,['version','forwardFailure','cleanupFailure','cleanupFailedComponents','profileCleanupState'])&&d.version===1&&Number.isSafeInteger(d.version)&&proofFault(d.forwardFailure)&&proofFault(d.cleanupFailure)&&Array.isArray(d.cleanupFailedComponents)&&d.cleanupFailedComponents.length<=6&&new Set(d.cleanupFailedComponents).size===d.cleanupFailedComponents.length&&d.cleanupFailedComponents.every(c=>typeof c==='string'&&proofComponents.includes(c)&&!['FORWARD','NONE'].includes(c))&&typeof d.profileCleanupState==='string'&&['NOT_CHECKED','QUERY_FAILED','SID_MISMATCH_REFUSED','SPECIAL_REFUSED','LOADED_REFUSED','REMOVE_FAILED','READBACK_FAILED','STILL_PRESENT','ABSENT_CONFIRMED','REMOVED_AND_ABSENT_CONFIRMED'].includes(d.profileCleanupState));
 proofNeed(!/S-\d-\d|[A-Za-z]:\\|grq25[a-f0-9]{12}/.test(JSON.stringify(value)));return value;
}
function proofCrc32(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function readCutoverProofArchive(bytes){
 try{
  proofNeed(Buffer.isBuffer(bytes)&&bytes.length>=22&&bytes.length<=16384);
  const end=bytes.length-22;proofNeed(bytes.readUInt32LE(end)===0x06054b50&&bytes.readUInt16LE(end+4)===0&&bytes.readUInt16LE(end+6)===0&&bytes.readUInt16LE(end+8)===1&&bytes.readUInt16LE(end+10)===1&&bytes.readUInt16LE(end+20)===0);
  const central=bytes.readUInt32LE(end+16),centralSize=bytes.readUInt32LE(end+12),name=Buffer.from('password-task-retention-proof.json');
  proofNeed(central>0&&central+centralSize===end&&centralSize===46+name.length&&bytes.readUInt32LE(central)===0x02014b50);
  const needed=bytes.readUInt16LE(central+6),flags=bytes.readUInt16LE(central+8),method=bytes.readUInt16LE(central+10),crc=bytes.readUInt32LE(central+16),packedSize=bytes.readUInt32LE(central+20),expandedSize=bytes.readUInt32LE(central+24),type=(bytes.readUInt32LE(central+38)>>>16)&0xf000;
  proofNeed([0,8].includes(method)&&(needed===20||method===0&&needed===10)&&(flags&~0x808)===0&&packedSize>0&&packedSize<=16384&&expandedSize>0&&expandedSize<=16384&&bytes.readUInt16LE(central+28)===name.length&&bytes.readUInt16LE(central+30)===0&&bytes.readUInt16LE(central+32)===0&&bytes.readUInt16LE(central+34)===0&&bytes.readUInt32LE(central+42)===0&&[0,0x8000].includes(type)&&(bytes.readUInt32LE(central+38)&0x10)===0&&bytes.subarray(central+46,central+46+name.length).equals(name));
  proofNeed(bytes.readUInt32LE(0)===0x04034b50&&bytes.readUInt16LE(4)===needed&&bytes.readUInt16LE(6)===flags&&bytes.readUInt16LE(8)===method&&bytes.readUInt16LE(26)===name.length&&bytes.readUInt16LE(28)===0&&bytes.subarray(30,30+name.length).equals(name));
  const begin=30+name.length,finish=begin+packedSize;proofNeed(finish<=central);
  if(flags&8)proofNeed(bytes.readUInt32LE(14)===0&&bytes.readUInt32LE(18)===0&&bytes.readUInt32LE(22)===0&&finish+16===central&&bytes.readUInt32LE(finish)===0x08074b50&&bytes.readUInt32LE(finish+4)===crc&&bytes.readUInt32LE(finish+8)===packedSize&&bytes.readUInt32LE(finish+12)===expandedSize);
  else proofNeed(finish===central&&bytes.readUInt32LE(14)===crc&&bytes.readUInt32LE(18)===packedSize&&bytes.readUInt32LE(22)===expandedSize);
  const packed=bytes.subarray(begin,finish);let expanded;
  if(method===8){const data=inflateRawSync(packed,{maxOutputLength:16384,info:true});proofNeed(data.engine.bytesWritten===packed.length);expanded=data.buffer;}else expanded=Buffer.from(packed);
  proofNeed(expanded.length===expandedSize&&proofCrc32(expanded)===crc);
  let wire=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(expanded);if(wire.startsWith('\uFEFF'))wire=wire.slice(1);if(wire.endsWith('\r\n'))wire=wire.slice(0,-2);else if(wire.endsWith('\n'))wire=wire.slice(0,-1);
  const result=JSON.parse(wire);proofNeed(object(result)&&JSON.stringify(result)===wire);proofResult(result);
  return frozenTree({result,resultSha256:hash(expanded),archiveSha256:hash(bytes),effectCapability:false});
 }catch{fail('ROTATION_CUTOVER_PROOF_ARCHIVE_REJECTED');}
}
function proofMetadata(bytes){
 const wire=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(wire);proofNeed(object(value));
 const stack=[],tokens=/"(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\])*"|[{}[\],:]/g;let token;
 while((token=tokens.exec(wire))){const t=token[0];if(t==='{')stack.push({object:true,key:true,seen:new Set()});else if(t==='[')stack.push({object:false});else if(t==='}'||t===']')stack.pop();else if(t===','&&stack.at(-1)?.object)stack.at(-1).key=true;else if(t[0]==='"'&&stack.at(-1)?.object&&stack.at(-1).key){const key=JSON.parse(t),frame=stack.at(-1);proofNeed(!frame.seen.has(key));frame.seen.add(key);frame.key=false;}}
 const finite=(item,depth=0)=>{proofNeed(depth<=40);if(typeof item==='number')proofNeed(Number.isFinite(item));if(object(item)||Array.isArray(item))for(const child of Object.values(item))finite(child,depth+1);};finite(value);return value;
}
function proofDate(value){proofNeed(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value)));const stamp=Date.parse(value);proofNeed(new Date(stamp).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z')));return stamp;}
export async function verifyCutoverCredentialProof(data,fetcher=fetch,now=Date.now()){
 try{
  proofNeed(cutoverData.has(data)&&typeof fetcher==='function'&&Number.isFinite(now)&&Date.parse(data.grant.issuedAt)<=now&&now<Date.parse(data.grant.expiresAt));
  const g=data.grant.credentialProof,a=data.proofApproval,archive=readCutoverProofArchive(cutoverBytes(g.archiveBase64,16384)),r=archive.result;
  proofNeed(r.complete&&proofTrue.every(k=>r[k]===true)&&proofFalse.every(k=>r[k]===false)&&r.failureCode===null&&r.failedStage===null&&r.cleanupFailureCode===null&&r.sourceRevision===a.sourceRevision&&r.scriptSha256===credentialProofScript&&r.approvalSha256===hash(cutoverBytes(g.approvalBase64,1024))&&r.runId===g.runId&&r.attemptId===a.attemptId);
  const get=async url=>{const response=await fetcher(url,{method:'GET',headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});proofNeed(response.status===200&&response.ok===true&&response.redirected===false&&response.url===url&&typeof response.body?.[Symbol.asyncIterator]==='function');const chunks=[];let total=0;for await(const chunk of response.body){proofNeed(chunk instanceof Uint8Array);total+=chunk.byteLength;proofNeed(total<=65536);chunks.push(Buffer.from(chunk));}proofNeed(total>0);return Buffer.concat(chunks);};
  const base='https://api.github.com/repos/haji84/AI-/',run=proofMetadata(await get(base+'actions/runs/'+g.runId));
  proofNeed(proofInteger(run.id,1,Number.MAX_SAFE_INTEGER)&&String(run.id)===g.runId&&run.run_attempt===1&&run.name==='GORIQ 1218 Ephemeral Password Task Retention Proof'&&run.path==='.github/workflows/gai-owner-task-credential-proof-1218.yml'&&run.event==='workflow_dispatch'&&run.status==='completed'&&run.conclusion==='success'&&run.head_sha===a.sourceRevision&&run.head_branch==='main'&&run.repository?.full_name==='haji84/AI-'&&proofInteger(run.repository.id,1,Number.MAX_SAFE_INTEGER)&&run.head_repository?.full_name==='haji84/AI-'&&run.head_repository.id===run.repository.id&&run.actor?.login==='haji84'&&run.triggering_actor?.login==='haji84');
  const issued=Date.parse(a.issuedAt),expires=Date.parse(a.expiresAt),created=proofDate(run.created_at),updated=proofDate(run.updated_at);proofNeed(issued<=created&&created<=updated&&updated<=now);
  const jobs=proofMetadata(await get(base+'actions/runs/'+g.runId+'/attempts/1/jobs?per_page=100'));proofNeed(jobs.total_count===1&&Array.isArray(jobs.jobs)&&jobs.jobs.length===1);const job=jobs.jobs[0];
  proofNeed(proofInteger(job.id,1,Number.MAX_SAFE_INTEGER)&&String(job.id)===g.jobId&&job.run_id===run.id&&job.run_attempt===1&&job.head_sha===a.sourceRevision&&job.name==='proof'&&job.status==='completed'&&job.conclusion==='success'&&proofInteger(job.runner_id,1,Number.MAX_SAFE_INTEGER)&&typeof job.runner_name==='string'&&/^GitHub Actions \d+$/.test(job.runner_name)&&job.runner_group_name==='GitHub Actions'&&Array.isArray(job.labels)&&job.labels.includes('windows-2025')&&!job.labels.includes('self-hosted')&&Array.isArray(job.steps)&&job.steps.length<=100);
  const step=name=>{const matches=job.steps.filter(s=>object(s)&&s.name===name);proofNeed(matches.length===1);const s=matches[0];proofNeed(proofInteger(s.number,1,100)&&s.status==='completed'&&s.conclusion==='success');return {...s,start:proofDate(s.started_at),end:proofDate(s.completed_at)};};
  const source=step('Require exact current main with successful CI'),execute=step('Inert plan or separately approved isolated credential-retention fixture'),upload=step('Retain closed proof only'),jobStart=proofDate(job.started_at),jobEnd=proofDate(job.completed_at);
  proofNeed(created<=jobStart&&issued<=jobStart&&jobStart<=source.start&&source.start<=source.end&&source.end<=execute.start&&execute.start<execute.end&&execute.end<=upload.start&&upload.start<=upload.end&&upload.end<=jobEnd&&jobEnd<=updated&&jobEnd-jobStart<=900000&&execute.end-execute.start<=660000&&issued<=execute.start&&execute.end<=expires&&source.number<execute.number&&execute.number<upload.number);
  const artifacts=proofMetadata(await get(base+'actions/runs/'+g.runId+'/artifacts?per_page=100'));proofNeed(artifacts.total_count===1&&Array.isArray(artifacts.artifacts)&&artifacts.artifacts.length===1);const artifact=artifacts.artifacts[0];
  proofNeed(proofInteger(artifact.id,1,Number.MAX_SAFE_INTEGER)&&String(artifact.id)===g.artifactId&&artifact.name==='goriq-1218-password-task-retention-proof'&&artifact.expired===false&&proofInteger(artifact.size_in_bytes,1,16384)&&artifact.digest==='sha256:'+archive.archiveSha256&&artifact.workflow_run?.id===run.id&&artifact.workflow_run.repository_id===run.repository.id&&artifact.workflow_run.head_repository_id===run.repository.id&&artifact.workflow_run.head_branch==='main'&&artifact.workflow_run.head_sha===a.sourceRevision);
  const artifactCreated=proofDate(artifact.created_at),artifactUpdated=proofDate(artifact.updated_at);proofNeed(upload.start<=artifactCreated&&artifactCreated<=artifactUpdated&&artifactUpdated<=jobEnd&&proofDate(artifact.expires_at)>now);
  const raw='https://raw.githubusercontent.com/haji84/AI-/'+a.sourceRevision+'/';proofNeed(hash(await get(raw+'scripts/owner-code-task-credential-retention-proof-1218.ps1'))===credentialProofScript&&hash(await get(raw+'.github/workflows/gai-owner-task-credential-proof-1218.yml'))===credentialProofWorkflow);
  const evidence=frozenTree({kind:'VERIFIED_CREDENTIAL_PROOF_DATA',effectCapability:false,referenceContentsVerified:false,runId:g.runId,jobId:g.jobId,artifactId:g.artifactId,archiveSha256:archive.archiveSha256,resultSha256:archive.resultSha256,approvalSha256:r.approvalSha256,proofSourceRevision:a.sourceRevision,proofScriptSha256:credentialProofScript,proofWorkflowSha256:credentialProofWorkflow,executionStartedAt:execute.started_at,executionCompletedAt:execute.completed_at,dispatchLedgerSha256:g.dispatchLedgerSha256,independentVerdictSha256:g.independentVerdictSha256});
  credentialProofData.set(evidence,{originalGrantSha256:data.originalGrantSha256});return evidence;
 }catch{fail('ROTATION_CUTOVER_PROOF_REJECTED');}
}
export async function verifyPublicRotationSource(grant,fetcher=fetch){
 const get=async path=>{const response=await fetcher(path,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||!response.body)fail('ROTATION_ENTRY_SOURCE_REJECTED');let n=0;const chunks=[];for await(const chunk of response.body){n+=chunk.byteLength;if(n>1048576)fail('ROTATION_ENTRY_SOURCE_REJECTED');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);};
 try{
  const base='https://api.github.com/repos/haji84/AI-/',main=JSON.parse((await get(base+'git/ref/heads/main')).toString()),run=JSON.parse((await get(base+'actions/runs/'+grant.ciRunId)).toString()),jobs=JSON.parse((await get(base+'actions/runs/'+grant.ciRunId+'/attempts/1/jobs?per_page=100')).toString());
  if(main.object?.sha!==grant.sourceRevision||String(run.id)!==grant.ciRunId||run.run_attempt!==1||run.name!=='CI'||run.path!=='.github/workflows/ci.yml'||run.event!=='push'||run.head_branch!=='main'||run.head_sha!==grant.sourceRevision||run.status!=='completed'||run.conclusion!=='success'||!Array.isArray(jobs.jobs)||jobs.jobs.length!==4||['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].some(name=>jobs.jobs.filter(j=>j.name===name&&j.status==='completed'&&j.conclusion==='success').length!==1))fail('ROTATION_ENTRY_SOURCE_REJECTED');
  for(const file of ROTATION_PUBLIC_SOURCE_FILES){if(hash(regular(join(root,file)))!==grant.sourceHashes[file]||hash(await get('https://raw.githubusercontent.com/haji84/AI-/'+grant.sourceRevision+'/'+file))!==grant.sourceHashes[file])fail('ROTATION_ENTRY_SOURCE_REJECTED');}
  return true;
 }catch{fail('ROTATION_ENTRY_SOURCE_REJECTED');}
}
export function bindRotationRunScope(scope,environment=process.env,now=Date.now()){
 if(!object(scope)||strings.some(key=>typeof scope[key]!=='string')||['maxAttempts','maxDurationSeconds','recoveryReserveSeconds'].some(key=>!Number.isInteger(scope[key])))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(scope.cohortAuthority?.kind==='original-cohort-digest'&&typeof scope.cohortAuthority.cohortSha256!=='string')fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(environment.GITHUB_ACTOR!=='haji84'||environment.GITHUB_REPOSITORY!=='haji84/AI-'||environment.GITHUB_REF!=='refs/heads/main'||typeof environment.GITHUB_SHA!=='string'||!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA)||typeof environment.GITHUB_RUN_ID!=='string'||!/^[1-9]\d*$/.test(environment.GITHUB_RUN_ID)||environment.GITHUB_RUN_ATTEMPT!=='1'||environment.JARVIS_PRODUCTION_CONFIG)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 const hasRun=Object.hasOwn(scope,'workflowRunId'),hasAttempt=Object.hasOwn(scope,'workflowRunAttempt');
 if(hasRun!==hasAttempt||hasRun&&(typeof scope.workflowRunId!=='string'||scope.workflowRunId!==environment.GITHUB_RUN_ID||scope.workflowRunAttempt!==1))fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 if(scope.sourceRevision!==environment.GITHUB_SHA)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 try{validateRotationScope(scope,now);}catch{fail('ROTATION_ENTRY_SCOPE_REQUIRED');}
 return globalThis.structuredClone(hasRun?scope:{...scope,workflowRunId:environment.GITHUB_RUN_ID,workflowRunAttempt:1});
}
export function serializeRotationRunScope(scope){return JSON.stringify(scope);}
export function decodeRotationEntryDescriptor(encoded){
 try{
  if(typeof encoded!=='string'||encoded.length>87384||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
  const bytes=Buffer.from(encoded,'base64');if(bytes.length>65536||bytes.toString('base64')!==encoded)fail('ROTATION_ENTRY_SCOPE_REQUIRED');
  const wire=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(wire);if(!object(value)||JSON.stringify(value)!==wire)fail('ROTATION_ENTRY_SCOPE_REQUIRED');return value;
 }catch{fail('ROTATION_ENTRY_SCOPE_REQUIRED');}
}
export function compileRotationEntryDescriptor(encoded,environment=process.env,now=Date.now()){
 const original=decodeRotationEntryDescriptor(encoded),scope=bindRotationRunScope(original,environment,now),wire=serializeRotationRunScope(scope);
 return {scope,scopeBase64:Buffer.from(wire).toString('base64'),originalDescriptorSha256:hash(JSON.stringify(original)),runtimeScopeSha256:hash(wire)};
}
export function buildRotationEntryEnvironment(environment,scopeBase64,descriptorSha256){
 const names=['OS','SystemRoot','SYSTEMROOT','WINDIR','Path','PATH','PATHEXT','COMSPEC','USERPROFILE','LOCALAPPDATA','TEMP','TMP','GITHUB_ACTOR','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'];
 const clean=Object.fromEntries(names.filter(key=>typeof environment[key]==='string').map(key=>[key,environment[key]]));
 clean.GORIQ_OWNER_ROTATION_SCOPE_BASE64=scopeBase64;clean.GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256=descriptorSha256;return clean;
}
export async function runBoundedRotationPreparation(factory,{durationMs=30000,clock=Date.now}={}){
 if(!Number.isInteger(durationMs)||durationMs<=0||durationMs>30000)fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 return await new Promise(done=>{
  const started=clock();let child,output='',bytes=0,problem=null,settled=false;
  const failure=code=>({schemaVersion:1,complete:false,failureCode:code,profileMatchesEnvironment:false});
  const finish=record=>{if(settled)return;settled=true;clearTimeout(kill);clearTimeout(hard);done(record.complete&&clock()-started>durationMs?failure('ROTATION_ENTRY_TIMEOUT'):record);};
  const stop=code=>{problem??=code;try{child?.kill();}catch{}};
  const kill=setTimeout(()=>stop('ROTATION_ENTRY_TIMEOUT'),Math.max(1,durationMs-500)),hard=setTimeout(()=>{stop('ROTATION_ENTRY_TIMEOUT');finish(failure(problem));},durationMs);
  try{
   child=factory();child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>1024){stop('ROTATION_ENTRY_PROTOCOL_FAILED');return;}output+=chunk;});child.stderr.on('data',()=>stop('ROTATION_ENTRY_PROTOCOL_FAILED'));child.on('error',()=>{stop('ROTATION_ENTRY_CHILD_UNAVAILABLE');finish(failure(problem));});
   child.on('close',exit=>{if(problem){finish(failure(problem));return;}try{const wire=output.trim(),r=JSON.parse(wire);if(JSON.stringify(r)!==wire||!exact(r,['schemaVersion','complete','failureCode','profileMatchesEnvironment'])||r.schemaVersion!==1||typeof r.complete!=='boolean'||typeof r.profileMatchesEnvironment!=='boolean'||exit!==(r.complete?0:1)||r.complete&&(r.failureCode!==null||!r.profileMatchesEnvironment)||!r.complete&&!prepCodes.includes(r.failureCode))fail('ROTATION_ENTRY_PROTOCOL_FAILED');finish(r);}catch{finish(failure('ROTATION_ENTRY_PROTOCOL_FAILED'));}});
  }catch{stop('ROTATION_ENTRY_CHILD_UNAVAILABLE');finish(failure(problem));}
 });
}

const fleetBooleans=['databaseBindingMatched','cohortAuthorityVerified','baselineCohortPreserved','fleetMetadataPreserved','identitiesPreserved','keysPreserved','workerLifecycleHistoryPreserved','auditRetainedHistoryPreserved','taskPayloadsPreserved','nonceProtectionPreserved'];
function projectController(value){
 const base=result('ROTATION_ENTRY_CONTROLLER_FAILED');
 if(exact(value,['schemaVersion','issue','complete','failureCode','wholeR06Verified'])&&value.schemaVersion===1&&value.issue===1218&&value.complete===false&&value.failureCode==='ROTATION_ACCEPTANCE_INCONCLUSIVE'&&value.wholeR06Verified===false)return base;
 if(!exact(value,['schemaVersion','issue','complete','rotation','fleetSqlitePreserved','fleet','pcSidecarsPreserved','wholeR06Verified','workerPrivateKeysVerified','sidecarAndCompassHistoryVerified'])||value.schemaVersion!==1||value.issue!==1218||typeof value.complete!=='boolean'||typeof value.fleetSqlitePreserved!=='boolean'||typeof value.pcSidecarsPreserved!=='boolean'||value.wholeR06Verified!==false||value.workerPrivateKeysVerified!==false||value.sidecarAndCompassHistoryVerified!==false)fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 validateRotationResult(value.rotation);
 let fleetChecks=null;
 if(value.fleet!==null){
  if(!object(value.fleet)||!['PASS','FAIL','INCONCLUSIVE'].includes(value.fleet.status)||fleetBooleans.some(key=>typeof value.fleet[key]!=='boolean'))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
  fleetChecks=Object.fromEntries(['status',...fleetBooleans].map(key=>[key,value.fleet[key]]));
 }
 if(value.fleetSqlitePreserved!==(fleetChecks?.status==='PASS')||fleetChecks===null&&value.pcSidecarsPreserved||fleetChecks?.status==='PASS'&&fleetBooleans.some(key=>!fleetChecks[key]))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 if(value.complete!==value.rotation.complete||(value.complete||value.rotation.rollbackVerified)&&(!value.fleetSqlitePreserved||!value.pcSidecarsPreserved||fleetChecks?.status!=='PASS'||fleetBooleans.some(key=>!fleetChecks[key])))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 return {...base,complete:value.complete,failureCode:value.complete?null:base.failureCode,rotation:value.rotation,fleetChecks,fleetSqlitePreserved:value.fleetSqlitePreserved,pcSidecarsPreserved:value.pcSidecarsPreserved};
}
export function rotationControllerDuration(scope,now=Date.now()){
 const expires=typeof scope?.expiresAt==='string'?Date.parse(scope.expiresAt):NaN,remaining=expires-now;
 // Narrow admission only; never rewrite the approved expiry. The controller's
 // own min(start+900s, expiry) deadline always precedes this transport bound.
 if(!Number.isFinite(remaining)||remaining<900000||remaining>1439000)fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 return remaining+1000;
}
export function validateRotationJobBudget(data,scope,environment=process.env,now=Date.now()){
 bindRotationRunScope(scope,environment,now);rotationControllerDuration(scope,now);
 return validateAllocatedRotationJob(data,scope,environment,now);
}
function validateAllocatedRotationJob(data,scope,environment,now){
 if(!object(data)||!Array.isArray(data.jobs)||data.jobs.length>100||data.total_count!==data.jobs.length)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 const matches=data.jobs.filter(job=>object(job)&&job.name==='inspect');
 if(matches.length!==1)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 const job=matches[0],start=typeof job.started_at==='string'?Date.parse(job.started_at):NaN;
 if(!Number.isSafeInteger(job.id)||job.id<=0||!Number.isSafeInteger(job.run_id)||String(job.run_id)!==environment.GITHUB_RUN_ID||job.run_attempt!==1||job.head_sha!==scope.sourceRevision||job.status!=='in_progress'||job.completed_at!==null||!Number.isFinite(start)||start>now)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 const deadline=start+24*60000; // Existing25min job, with60s reserved for cleanup.
 if(Date.parse(scope.expiresAt)+1000>deadline)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 return deadline;
}
export async function readRotationJobBudget(scope,environment=process.env,fetcher=fetch,clock=Date.now){
 try{
  bindRotationRunScope(scope,environment,clock());
  const response=await fetcher(`https://api.github.com/repos/haji84/AI-/actions/runs/${environment.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok||!response.body)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.byteLength;if(size>65536)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');chunks.push(Buffer.from(chunk));}
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks)));
  validateRotationJobBudget(record,scope,environment,clock());return record;
 }catch{fail('ROTATION_ENTRY_CONTEXT_REQUIRED');}
}
async function readPublicRotationJobBudget(grant,environment=process.env){
 try{
  const response=await fetch(`https://api.github.com/repos/haji84/AI-/actions/runs/${environment.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok||!response.body)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');let n=0;const chunks=[];for await(const chunk of response.body){n+=chunk.byteLength;if(n>65536)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');chunks.push(Buffer.from(chunk));}
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));validateAllocatedRotationJob(record,grant,environment,Date.now());return record;
 }catch{fail('ROTATION_ENTRY_CONTEXT_REQUIRED');}
}
function projectExerciseController(value){
 if(!exact(value,['schemaVersion','issue','complete','exercise','fleetSqlitePreserved','fleet','pcSidecarsPreserved','wholeR06Verified','workerPrivateKeysVerified','sidecarAndCompassHistoryVerified'])||value.schemaVersion!==2||value.issue!==1218||value.wholeR06Verified!==false||value.workerPrivateKeysVerified!==false||value.sidecarAndCompassHistoryVerified!==false||typeof value.fleetSqlitePreserved!=='boolean'||typeof value.pcSidecarsPreserved!=='boolean')fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 validateRotationExerciseResult(value.exercise);
 let fleetChecks=null;
 if(value.fleet!==null){if(!object(value.fleet)||!['PASS','FAIL','INCONCLUSIVE'].includes(value.fleet.status)||fleetBooleans.some(k=>typeof value.fleet[k]!=='boolean'))fail('ROTATION_ENTRY_PROTOCOL_FAILED');fleetChecks=Object.fromEntries(['status',...fleetBooleans].map(k=>[k,value.fleet[k]]));}
 if(value.complete!==value.exercise.complete||value.fleetSqlitePreserved!==(fleetChecks?.status==='PASS')||fleetChecks?.status==='PASS'&&fleetBooleans.some(k=>!fleetChecks[k])||(value.complete||value.exercise.restoration.recoveryVerified||value.exercise.rotation.rollbackVerified)&&(!value.fleetSqlitePreserved||!value.pcSidecarsPreserved))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 return {complete:value.complete,exercise:value.exercise,fleetChecks,fleetSqlitePreserved:value.fleetSqlitePreserved,pcSidecarsPreserved:value.pcSidecarsPreserved};
}
// Never truncate the unchanged controller's recovery window for startup delay,
// stderr or bad output. A live invocation must bind its unchanged receipt here.
export async function runBoundedRotationController(factory,{scope,durationMs=905000,clock=Date.now,exercise=false}={}){
 const started=clock();if(scope)durationMs=rotationControllerDuration(scope,started);
 if(!Number.isInteger(durationMs)||durationMs<=0||durationMs>1440000)fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 return await new Promise(done=>{
  let child,output='',bytes=0,problem=null,settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);done(value);};
  const timer=setTimeout(()=>{try{child?.kill();}catch{}finish(result('ROTATION_ENTRY_TIMEOUT'));},durationMs);
  try{
   child=factory();child.stdout.setEncoding('utf8');
   child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>65536){problem='ROTATION_ENTRY_PROTOCOL_FAILED';return;}if(!problem)output+=chunk;});
   child.stderr.on('data',()=>{problem='ROTATION_ENTRY_PROTOCOL_FAILED';});
   child.on('error',()=>{problem='ROTATION_ENTRY_CHILD_UNAVAILABLE';});
   child.on('close',exit=>{
    if(clock()-started>durationMs){finish(result('ROTATION_ENTRY_TIMEOUT'));return;}
    if(problem){finish({...result(problem),childCleanupVerified:true});return;}
    try{
     const wire=output.trim(),value=JSON.parse(wire);if(JSON.stringify(value)!==wire||exit!==(value.complete?0:1))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
     finish({...(exercise?projectExerciseController(value):projectController(value)),childCleanupVerified:true});
    }catch{finish({...result('ROTATION_ENTRY_PROTOCOL_FAILED'),childCleanupVerified:true});}
   });
  }catch{finish(result('ROTATION_ENTRY_CHILD_UNAVAILABLE'));}
 });
}

function regular(path,limit=1048576){const metadata=lstatSync(path);if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.size>limit||realpathSync.native(path).toLowerCase()!==resolve(path).toLowerCase())fail('ROTATION_ENTRY_SOURCE_REJECTED');return readFileSync(path);}
function result(code){return {schemaVersion:1,issue:1218,operation:'authorized-rotation-acceptance',complete:false,failureCode:code,sourceRevision:null,originalDescriptorSha256:null,runtimeScopeSha256:null,childCleanupVerified:false,rotation:null,fleetChecks:null,wholeR06Verified:false};}
function publicResult(code){return {schemaVersion:2,issue:1218,operation:'rotation-restoration-exercise',complete:false,failureCode:code,sourceRevision:null,originalGrantSha256:null,workflowRunId:null,workflowRunAttempt:null,publicSourceVerified:false,localScopeBound:false,claimConsumed:false,actualWindowsOwnerContextVerified:false,childCleanupVerified:false,exercise:null,fleetChecks:null,fleetSqlitePreserved:false,pcSidecarsPreserved:false,wholeR06Verified:false};}
async function run(){
 let compiled;const answer=publicResult('ROTATION_ENTRY_SCOPE_REQUIRED');
 try{
  compiled=compilePublicRotationGrant(process.env.GORIQ_OWNER_ROTATION_SCOPE_BASE64??'');const {grant}=compiled;
  answer.sourceRevision=grant.sourceRevision;answer.originalGrantSha256=compiled.originalGrantSha256;answer.workflowRunId=process.env.GITHUB_RUN_ID;answer.workflowRunAttempt=1;
  if(process.platform!=='win32'||resolve(process.cwd()).toLowerCase()!==root.toLowerCase())fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
  rotationControllerDuration(grant);await verifyPublicRotationSource(grant);answer.publicSourceVerified=true;
  const jobBudget=await readPublicRotationJobBudget(grant);
  const env=buildRotationEntryEnvironment(process.env,process.env.GORIQ_OWNER_ROTATION_SCOPE_BASE64,compiled.originalGrantSha256);env.GITHUB_WORKFLOW_REF=process.env.GITHUB_WORKFLOW_REF;
  const shell=win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const preparation=await runBoundedRotationPreparation(()=>spawn(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',join(root,'scripts','owner-code-rotation-native-1218.ps1'),'-PreparePublic'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env}));
  if(!preparation.complete)fail(preparation.failureCode);
  const stage=win32.join(process.env.USERPROFILE,`.goriq-owner-rotation-1218-${grant.approvalId}`),receipt=win32.join(stage,'.gai-results','owner-code-rotation-scope.json'),scopeBytes=regular(receipt,65536),scope=bindRotationRunScope(JSON.parse(scopeBytes.toString('utf8')),process.env);
  const retainedGrant=regular(win32.join(stage,'.gai-results','original-grant.json'),65536);
  if(hash(retainedGrant)!==compiled.originalGrantSha256||scope.attemptId!==grant.approvalId||scope.issuedAt!==grant.issuedAt||scope.expiresAt!==grant.expiresAt||scope.sourceRevision!==grant.sourceRevision||hash(scope.ownerSid)!==grant.ownerSidSha256)fail('ROTATION_ENTRY_SOURCE_REJECTED');
  for(const file of ROTATION_PUBLIC_SOURCE_FILES)if(hash(regular(win32.join(stage,file)))!==grant.sourceHashes[file])fail('ROTATION_ENTRY_SOURCE_REJECTED');
  for(const file of ROTATION_SOURCE_FILES)if(scope.sourceHashes[file]!==grant.sourceHashes[file])fail('ROTATION_ENTRY_SOURCE_REJECTED');
  const claim=JSON.parse(regular(stage+'.claim',4096).toString('utf8'));
  if(!exact(claim,['schemaVersion','attemptId','originalDescriptorSha256','runtimeScopeSha256','sourceRevision','workflowRunId','workflowRunAttempt'])||claim.schemaVersion!==1||claim.attemptId!==grant.approvalId||claim.originalDescriptorSha256!==compiled.originalGrantSha256||claim.runtimeScopeSha256!==hash(scopeBytes)||claim.sourceRevision!==scope.sourceRevision||claim.workflowRunId!==scope.workflowRunId||claim.workflowRunAttempt!==1)fail('ROTATION_ENTRY_ATTEMPT_CONSUMED');
  if(hash(regular(process.execPath,268435456))!==scope.nodeSha256)fail('ROTATION_ENTRY_NODE_REJECTED');
  answer.localScopeBound=true;answer.claimConsumed=true;answer.actualWindowsOwnerContextVerified=true;
  validateRotationJobBudget(jobBudget,scope);
  const controller=await runBoundedRotationController(()=>spawn(process.execPath,['--disable-warning=ExperimentalWarning',win32.join(stage,'scripts','owner-code-rotation-exercise.mjs'),'--apply','--authorization',receipt],{cwd:stage,windowsHide:false,stdio:['ignore','pipe','pipe'],env}),{scope,exercise:true});
  for(const key of ['complete','childCleanupVerified','exercise','fleetChecks','fleetSqlitePreserved','pcSidecarsPreserved'])if(Object.hasOwn(controller,key))answer[key]=controller[key];
  answer.failureCode=answer.complete?null:codes.includes(controller.failureCode)?controller.failureCode:'ROTATION_ENTRY_CONTROLLER_FAILED';return answer;
 }catch(error){answer.failureCode=codes.includes(error.message)?error.message:'ROTATION_ENTRY_SCOPE_REQUIRED';return answer;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).includes('--owned-cutover-peer')){try{if(process.argv.length!==3||process.argv[2]!=='--owned-cutover-peer')throw 0;await runOwnedCutoverPeer();}catch{console.error('GORIQ_OWNED_PEER_REFUSED');process.exitCode=1;}}
 else if(process.argv.length===2)console.log('PLAN ONLY: live rotation requires fresh separate High approval and an exact real-run-bound protected receipt.');
 else if(process.argv.length===3&&process.argv[2]==='--verify-public-grant'){try{const {grant}=compilePublicRotationGrant(process.env.GORIQ_OWNER_ROTATION_SCOPE_BASE64??'');await verifyPublicRotationSource(grant);console.log('PUBLIC_ROTATION_GRANT_VERIFIED');}catch{console.log('PUBLIC_ROTATION_GRANT_REFUSED');process.exitCode=1;}}
 else{const value=process.argv.length===3&&process.argv[2]==='--run'?await run():result('ROTATION_ENTRY_CONTEXT_REQUIRED');console.log(JSON.stringify(value));if(!value.complete)process.exitCode=1;}
}
