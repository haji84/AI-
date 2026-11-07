/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as native from './owner-code-rotation-native-1218.mjs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {grant,environment,encode,now} from '../tests/fixtures/owner-code-production-proof.fixture.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root='/public/installed-release';
function configuration(){return {version:1,commit:'c'.repeat(40),releaseRoot:root,environment:{JARVIS_OWNER_SECRET:'public-owner-secret-value-123456789',JARVIS_OWNER_TOKEN:'public-owner-token-value-123456789',JARVIS_REMOTE_GATEWAY_TOKEN:'public-gateway-token-value-123456789',JARVIS_REMOTE_ALLOWED_SERIALS:'PUBLIC-DEVICE',JARVIS_ADB_PATH:'/public/adb',JARVIS_SCRCPY_SERVER_PATH:'/public/scrcpy',JARVIS_DB_PATH:'/public/db',JARVIS_TEACHING_PATH:'/public/teaching',JARVIS_REMOTE_ASSIST_AUDIT_PATH:'/public/audit',JARVIS_REMOTE_ASSIST_RECORDING_DIR:'/public/recording',JARVIS_PUBLIC_BROKER_URL:'https://192.168.1.25:8792',JARVIS_WORKER_INSTALL_URL:'https://example.invalid/worker.apk',JARVIS_PRIVATE_WORKER_HOST:'192.168.1.25',JARVIS_PRIVATE_WORKER_CERT_PATH:'/public/cert',JARVIS_PRIVATE_WORKER_KEY_PATH:'/public/key'}};}
const platform={SystemRoot:'C:\\Windows',ComSpec:'C:\\Windows\\System32\\cmd.exe',USERPROFILE:'C:\\Users\\Public Owner',LOCALAPPDATA:'C:\\Users\\Public Owner\\AppData\\Local',TEMP:'C:\\Users\\Public Owner\\JARVIS\\tmp',TMP:'C:\\Users\\Public Owner\\JARVIS\\tmp',PATH:'C:\\public-node;C:\\Windows\\System32;C:\\Windows',PATHEXT:'.COM;.EXE;.BAT;.CMD',PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'};
const bytes=text=>Buffer.from(text,'utf8');
function derive(c=configuration(),files=[bytes(''),bytes('')],p=platform){assert.equal(typeof native.deriveCutoverCleanEnvironmentData,'function');return native.deriveCutoverCleanEnvironmentData(c,root,files,p);}

test('clean environment mirrors the exact known loader first-file and case-insensitive missing-key behavior without acquiring authority',()=>{
 const files=[bytes('\uFEFF# comment\r\n PUBLIC_FIRST = "first value"\r\nPUBLIC_EMPTY=\r\nNO_EQUALS\r\n=ignored\r\nPUBLIC_BARE_CR=one\rtwo\njarvis_owner_secret=ignored-public-fallback\nPUBLIC_DUP=one\npublic_dup=two\n'),bytes("PUBLIC_FIRST=second\nPUBLIC_EMPTY=replacement\nPUBLIC_SECOND='second value'\n")];
 const r=derive(configuration(),files);assert.equal(r.profile,'goriq-clean-start-environment-data-v1');assert.equal(r.effectCapability,false);assert.equal(r.environment.PUBLIC_FIRST,'first value');assert.equal(r.environment.PUBLIC_EMPTY,'');assert.equal(r.environment.PUBLIC_SECOND,'second value');assert.equal(r.environment.PUBLIC_DUP,'one');assert.equal(r.environment.PUBLIC_BARE_CR,'one\rtwo');assert.equal(r.environment.JARVIS_OWNER_SECRET,configuration().environment.JARVIS_OWNER_SECRET);assert.equal(r.environment.NODE_ENV,'production');assert.equal(r.environment.SystemRoot,platform.SystemRoot);assert.equal(r.environment.NODE_OPTIONS,undefined);assert.equal(r.environment.PSModulePath,platform.PSModulePath);assert.deepEqual(r.fallbackSha256,files.map(hash));assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.environment),true);
});

test('all audited Node and CLR startup controls refuse fallback reinsertion including empty values and mixed-case names',()=>{
 const forbidden=['NODE_OPTIONS','node_path','NODE_COMPILE_CACHE','NODE_REPL_EXTERNAL_MODULE','NODE_EXTRA_CA_CERTS','NODE_ICU_DATA','NODE_PRESERVE_SYMLINKS_MAIN','NODE_CHANNEL_SERIALIZATION_MODE','NODE_TLS_REJECT_UNAUTHORIZED','NODE_USE_SYSTEM_CA','OPENSSL_CONF','OPENSSL_CONF_INCLUDE','OPENSSL_MODULES','OPENSSL_ENGINES','OPENSSL_ia32cap','SSL_CERT_FILE','HTTP_PROXY','https_proxy','WATCH_REPORT_DEPENDENCIES','COR_ENABLE_PROFILING','cor_profiler_path_64','APPDOMAIN_MANAGER_ASM','APPDOMAIN_MANAGER_TYPE','DEVPATH','COMPLUS_MDA','PSModuleAnalysisCachePath','PSModulePath','SystemRoot','PATH','USERPROFILE','JARVIS_PRODUCTION_CONFIG'];
 for(const name of forbidden)for(const value of ['', 'PUBLIC_INJECTION'])for(const index of [0,1]){const files=[bytes(''),bytes('')];files[index]=bytes(`${name}=${value}`);assert.throws(()=>derive(configuration(),files),/^Error: ROTATION_CUTOVER_ENVIRONMENT_REJECTED$/);}
});

test('normal-start projection excludes exactly the owner-secret field and preserves all other configuration fields',()=>{
 const before=configuration(),rotated=structuredClone(before);rotated.environment.JARVIS_OWNER_SECRET='public-new-owner-secret-value-123456789';assert.equal(derive(before).nonOwnerProjectionSha256,derive(rotated).nonOwnerProjectionSha256);
 for(const mutate of [c=>c.environment.JARVIS_OWNER_TOKEN+='changed',c=>c.extra={JARVIS_OWNER_SECRET:'public-extra'},c=>c.commit='d'.repeat(40),c=>c.releaseRoot='/other']){const changed=structuredClone(before);mutate(changed);if(changed.releaseRoot!==root)assert.throws(()=>derive(changed),/^Error: ROTATION_CUTOVER_ENVIRONMENT_REJECTED$/);else assert.notEqual(derive(before).nonOwnerProjectionSha256,derive(changed).nonOwnerProjectionSha256);}
 const reversed={...before,environment:Object.fromEntries(Object.entries(before.environment).reverse())};assert.equal(derive(before).nonOwnerProjectionSha256,derive(reversed).nonOwnerProjectionSha256);
});

test('malformed, oversized, extra fallback files and unbound platform shapes refuse before returning any environment',()=>{
 for(const files of [[bytes('')],[bytes(''),bytes(''),bytes('')],[Buffer.from([255]),bytes('')],[Buffer.alloc(65537),bytes('')],[bytes('PUBLIC_BAD\0NAME=value'),bytes('')]])assert.throws(()=>derive(configuration(),files),/^Error: ROTATION_CUTOVER_ENVIRONMENT_REJECTED$/);
 for(const p of [{...platform,NODE_OPTIONS:'PUBLIC_INJECTION'},{...platform,PATH:''},{...platform,USERPROFILE:7},{...platform,PSModulePath:'PUBLIC\nPRIVATE'}])assert.throws(()=>derive(configuration(),[bytes(''),bytes('')],p),/^Error: ROTATION_CUTOVER_ENVIRONMENT_REJECTED$/);
});


test('fixed clean command data has literal startup removals, native SystemPS ordering and no executable authority',()=>{
 const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';const p=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File','tests/owner-code-cutover-clean-start.fixture.ps1','-Root',process.cwd()],{encoding:'utf8',timeout:15000,maxBuffer:16384});assert.equal(p.error,undefined);assert.equal(p.status,0,p.stdout+p.stderr);assert.equal(p.stderr,'');const r=JSON.parse(p.stdout);assert.equal(r.pass,true);assert.equal(r.nativeEffects,0);assert.equal(r.authority,false);assert.equal(r.mechanismExecuted,false);assert.equal(r.unsafeCases,22);assert.ok(r.commandLength<=8191);
});


test('normal-start flags and caller-shaped data cannot acquire an unconnected startup or administrative capability',()=>{
 const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
 for(const flags of [['-StartOnly'],['-StartOnly','-PreparePublic']]){const p=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/owner-code-rotation-native-1218.ps1',...flags],{encoding:'utf8',timeout:15000,maxBuffer:16384,env:{...process.env,GITHUB_ACTOR:'PUBLIC_DENIED',GORIQ_OWNER_ROTATION_SCOPE_BASE64:'PUBLIC_NOT_A_GRANT'}});assert.equal(p.error,undefined);assert.equal(p.status,1);assert.equal(p.stdout,'');assert.equal(p.stderr.trim(),'GORIQ_NORMAL_START_REFUSED');}
});


test('actual private fallback acquisition binds five known installed loader sources and exactly two bounded inputs without promoting environment authority',()=>{
 const g=grant();for(const name of Object.keys(g.sourceHashes))g.sourceHashes[name]=hash(readFileSync(name));const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';const p=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File','tests/owner-code-cutover-private-bootstrap.fixture.ps1','-Scenario','fallback'],{input:JSON.stringify({encoded:encode(g),environment,now:new Date(now).toISOString(),nodeExecutable:process.execPath}),encoding:'utf8',timeout:30000,maxBuffer:16384});assert.equal(p.error,undefined);assert.equal(p.status,0,p.stdout+p.stderr);assert.equal(p.stderr,'');const r=JSON.parse(p.stdout);assert.equal(r.pass,true);assert.equal(r.actualNativeCalls,0);assert.equal(r.targetEnvironmentVerified,false);assert.equal(r.fallbackCases.length,21);
});


test('fallback cannot replace the verified Windows directory alias or supply process execution policy',()=>{
 for(const name of ['WINDIR','windir','PSExecutionPolicyPreference','pSeXeCuTiOnPoLiCyPrEfErEnCe'])for(const value of ['',name.toUpperCase()==='WINDIR'?'C:\\PUBLIC_UNBOUND_WINDOWS':'Bypass'])for(const index of [0,1]){const files=[bytes(''),bytes('')];files[index]=bytes(`${name}=${value}`);assert.throws(()=>derive(configuration(),files),/^Error: ROTATION_CUTOVER_ENVIRONMENT_REJECTED$/);}
 assert.equal(derive().environment.WINDIR,platform.SystemRoot);assert.equal(derive().environment.PSExecutionPolicyPreference,undefined);
});


test('actual hosted Windows metadata primitives preserve fixed-root ACL, held identity, typed absence and owned junction refusal',{skip:process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'},()=>{
 const g=grant();for(const name of Object.keys(g.sourceHashes))g.sourceHashes[name]=hash(readFileSync(name));const shell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');const p=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File','tests/owner-code-cutover-private-bootstrap.fixture.ps1','-Scenario','compiled-os'],{input:JSON.stringify({encoded:encode(g),environment,now:new Date(now).toISOString(),nodeExecutable:process.execPath}),encoding:'utf8',timeout:30000,maxBuffer:16384});assert.equal(p.error,undefined);assert.equal(p.status,0,p.stdout+p.stderr);assert.equal(p.stderr,'');const r=JSON.parse(p.stdout);for(const key of ['pass','actualWindowsMetadataObserved','actualReadonlyNativeCalls','rawAclProjected','typedAbsenceVerified','fileIdentityStable','heldDeleteRefused','reparseRefused','temporaryObjectsRemoved'])assert.equal(r[key],true);assert.ok(['ABSENT_DATA','REFUSED'].includes(r.platformObservation));assert.equal(r.ownedTemporaryFilesystemObjects,4);assert.equal(r.directNativeWrapperCalls,6);assert.equal(r.observerAdditionalNativeReadCountKnown,false);assert.equal(r.actualProductNativeEffects,0);assert.equal(r.taskAccountDpapiCalls,0);assert.equal(r.authority,false);
});
