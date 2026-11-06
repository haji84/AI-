import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as entry from './owner-code-rotation-native-1218.mjs';
import {approval,encode,environment,fixture,hash,now,resultBytes,successResult,trueFlags,falseFlags,zip} from '../tests/fixtures/owner-code-production-proof.fixture.mjs';

function read(bytes){assert.equal(typeof entry.readCutoverProofArchive,'function','Task2 archive gate is not implemented');return entry.readCutoverProofArchive(bytes);}
async function verify(f){assert.equal(typeof entry.verifyCutoverCredentialProof,'function','Task2 official proof gate is not implemented');const data=entry.compilePublicCutoverGrant(encode(f.grant),environment,now);return entry.verifyCutoverCredentialProof(data,f.fetcher,now);}
const reject=f=>assert.rejects(()=>verify(f),error=>error.message==='ROTATION_CUTOVER_PROOF_REJECTED');
function rewrite(f,value){const archive=zip([{name:'password-task-retention-proof.json',bytes:Buffer.isBuffer(value)?value:resultBytes(value)}]);f.grant.credentialProof.archiveBase64=archive.toString('base64');f.artifact.digest='sha256:'+hash(archive);f.artifact.size_in_bytes=archive.length;}

test('actual failed32 GitHub ZIP profile parses as closed49 DATA and remains a failed proof',async()=>{
 const bytes=readFileSync('tests/fixtures/owner-code-proof32-failed.zip');assert.equal(hash(bytes),'98151bf906672fb07037d854503e31cb34382895c722d94c8f4bb7a132ce1e8f');
 const data=read(bytes);assert.equal(data.effectCapability,false);assert.equal(Object.keys(data.result).length,49);assert.equal(data.result.complete,false);assert.equal(data.result.baselineRan,true);assert.equal(data.result.changedRan,false);assert.equal(data.result.restoredRan,false);assert.equal(data.result.cleanupVerified,false);
 await reject(fixture(bytes));
});
test('synthetic FakeFetcher proof verifies original22, exact official records and source compatibility without native authority',async()=>{
 const f=fixture(),data=await verify(f);
 assert.equal(data.kind,'VERIFIED_CREDENTIAL_PROOF_DATA');assert.equal(data.effectCapability,false);assert.equal(data.referenceContentsVerified,false);
 assert.equal(data.archiveSha256,hash(f.archive));assert.equal(data.approvalSha256,hash(Buffer.from(JSON.stringify(approval()))));
 assert.equal(data.proofSourceRevision,'c'.repeat(40));assert.notEqual(data.proofSourceRevision,f.grant.sourceRevision,'historical1698/a56 equivalence is explicit');
 assert.equal(data.executionStartedAt,'2026-11-05T16:02:00Z');assert.equal(data.executionCompletedAt,'2026-11-05T16:09:00Z');
 assert.equal(data.dispatchLedgerSha256,'e'.repeat(64));assert.equal(data.independentVerdictSha256,'f'.repeat(64));assert.ok(Object.isFrozen(data));
 assert.deepEqual(f.calls.map(c=>c.url),f.urls);
 for(const c of f.calls){assert.equal(c.options.method,'GET');assert.equal(c.options.redirect,'error');assert.ok(c.options.signal);assert.equal(c.options.headers.Authorization,undefined);}
 const copied=JSON.parse(JSON.stringify(entry.compilePublicCutoverGrant(encode(f.grant),environment,now)));const untouched=fixture();await assert.rejects(()=>entry.verifyCutoverCredentialProof(copied,untouched.fetcher,now));assert.equal(untouched.calls.length,0);
});
test('fixed artifact writer forms allow one UTF8BOM and one known line ending, including real descriptor and UTF8 flags',async()=>{
 for(const bom of [false,true])for(const ending of ['','\n','\r\n'])for(const utf8 of [false,true]){
  const bytes=resultBytes(successResult(),{bom,ending}),archive=zip([{name:'password-task-retention-proof.json',bytes}],{utf8});assert.equal(read(archive).result.complete,true);assert.equal((await verify(fixture(archive))).effectCapability,false);
 }
 assert.equal(read(zip([{name:'password-task-retention-proof.json',bytes:resultBytes()}],{method:0,descriptor:false})).result.complete,true);
});
test('each existing required execution and cleanup flag is mandatory and forbidden effects stay forbidden',async()=>{
 for(const key of ['complete',...trueFlags]){const f=fixture(),r=successResult();r[key]=false;rewrite(f,r);await reject(f);}
 for(const key of falseFlags){const f=fixture(),r=successResult();r[key]=true;rewrite(f,r);await reject(f);}
});
test('closed49 bindings/types reject wrapper output, extra fields, wrong source/run/nonce/hash and numeric coercions',async()=>{
 for(const mutate of [r=>r.mode='WRAPPER_ERROR',r=>r.schemaVersion='3',r=>r.runAttempt=true,r=>r.nativeZBookAcceptanceCredit=1,r=>r.runId=1002,r=>r.attemptId='33333333-3333-4333-8333-333333333333',r=>r.sourceRevision='a'.repeat(40),r=>r.scriptSha256='0'.repeat(64),r=>r.approvalSha256='0'.repeat(64),r=>r.failureCode='PROOF_OPERATION_FAILED',r=>r.failedStage='cleanup',r=>r.cleanupFailureCode='PROOF_CLEANUP_FAILED',r=>r.extra='fixture-private-canary',r=>r.windowsBuild='fixture-private-canary',r=>r.conditionalBatchRightAdded=1,r=>delete r.changedRan]){const f=fixture(),r=successResult();mutate(r);rewrite(f,r);await reject(f);}
});
test('diagnostics preserve existing recovered-fault acceptance but reject unknown keys/enums and nonnumeric provider codes',async()=>{
 const fault={component:'ACCOUNT_DISABLE',operation:'OTHER',origin:'CALL_THROW',callState:'THREW',exceptionKind:'CIM',hresult:-2146233088,win32NativeCode:null,cimNativeCode:1,cimStatusCode:1,cimProviderErrorCode:2147943726};
 const recovered=fixture(),r=successResult();r.diagnostics.cleanupFailure=fault;r.diagnostics.cleanupFailedComponents=['ACCOUNT_DISABLE'];rewrite(recovered,r);assert.equal((await verify(recovered)).kind,'VERIFIED_CREDENTIAL_PROOF_DATA');
 for(const mutate of [d=>d.version=true,d=>d.extra='fixture-private-canary',d=>d.profileCleanupState=['NOT_CHECKED'],d=>d.cleanupFailedComponents=['FILES','FILES'],d=>d.forwardFailure={...fault,cimProviderErrorCode:'2147943726'},d=>d.forwardFailure={...fault,cimProviderErrorCode:true},d=>d.forwardFailure={...fault,hresult:-2147483649},d=>d.forwardFailure={...fault,origin:'fixture-private-canary'}]){const f=fixture(),value=successResult();mutate(value.diagnostics);rewrite(f,value);await reject(f);}
});
test('official repository/workflow/run/attempt and hosted Windows job identity cannot be replaced by claimed PASS',async()=>{
 for(const mutate of [f=>f.run.repository.full_name='other/repo',f=>f.run.head_repository.id=11,f=>f.run.id++,f=>f.run.id='1002',f=>f.run.actor.login='other',f=>f.run.triggering_actor.login='other',f=>f.run.event='push',f=>f.run.path='other.yml',f=>f.run.name='other',f=>f.run.head_branch='feature',f=>f.run.head_sha='a'.repeat(40),f=>f.run.run_attempt=2,f=>f.run.status='unknown',f=>f.run.conclusion='failure',f=>f.job.id++,f=>f.job.run_id++,f=>f.job.run_attempt=2,f=>f.job.name='other',f=>f.job.status='in_progress',f=>f.job.conclusion='failure',f=>f.job.runner_group_name='self-hosted',f=>f.job.labels=['self-hosted','windows-2025'],f=>f.job.labels=['ubuntu-latest'],f=>f.job.runner_name='private-worker',f=>f.records[1].total_count=2,f=>f.records[1].jobs.push({...f.job})]){const f=fixture();mutate(f);await reject(f);}
});
test('original lease and actual official proof-step times are required despite successful metadata and true deadline flags',async()=>{
 for(const mutate of [f=>f.job.started_at='2026-11-05T15:59:59Z',f=>f.job.steps[1].started_at='2026-11-05T15:59:59Z',f=>f.job.steps[1].completed_at='2026-11-05T17:00:01Z',f=>f.job.steps[1].completed_at='2026-11-05T16:14:00Z',f=>f.job.steps[1].completed_at='unknown',f=>f.job.steps[1].conclusion='failure',f=>f.job.steps[1].name='claimed executor',f=>f.job.steps.push({...f.job.steps[1]}),f=>f.job.steps[0].conclusion='failure',f=>f.job.steps[2].conclusion='failure',f=>f.job.steps[2].number=1,f=>f.job.completed_at='2026-11-05T16:20:00Z',f=>f.run.created_at='2026-11-05T15:59:59Z']){const f=fixture();mutate(f);await reject(f);}
 const lease=fixture(),a=approval(),r=successResult();a.issuedAt='2026-11-05T15:58:00.000Z';a.expiresAt='2026-11-05T16:08:00.000Z';lease.grant.credentialProof.approvalBase64=encode(a);r.approvalSha256=hash(Buffer.from(JSON.stringify(a)));rewrite(lease,r);await reject(lease);
 const wrapper=fixture();wrapper.job.steps[1].completed_at='2026-11-05T16:13:01Z';wrapper.job.steps[2].started_at='2026-11-05T16:13:10Z';wrapper.job.steps[2].completed_at='2026-11-05T16:13:40Z';wrapper.job.completed_at='2026-11-05T16:13:50Z';wrapper.artifact.created_at='2026-11-05T16:13:20Z';wrapper.artifact.updated_at='2026-11-05T16:13:40Z';wrapper.run.updated_at='2026-11-05T16:13:50Z';await reject(wrapper);
 const job=fixture();job.job.steps[2].started_at='2026-11-05T16:16:10Z';job.job.steps[2].completed_at='2026-11-05T16:16:40Z';job.job.completed_at='2026-11-05T16:17:00Z';job.artifact.created_at='2026-11-05T16:16:20Z';job.artifact.updated_at='2026-11-05T16:16:40Z';job.run.updated_at='2026-11-05T16:17:00Z';await reject(job);
});
test('official artifact digest and unique identity are required; no caller digest or raw source substitute is accepted',async()=>{
 for(const mutate of [f=>delete f.artifact.digest,f=>f.artifact.digest='sha256:'+'0'.repeat(64),f=>f.artifact.id++,f=>f.artifact.name='other',f=>f.artifact.expired=true,f=>f.artifact.expired='false',f=>f.artifact.expires_at='2026-11-06T17:00:00Z',f=>f.artifact.workflow_run.head_sha='a'.repeat(40),f=>f.artifact.workflow_run.id++,f=>f.artifact.workflow_run.repository_id=11,f=>f.artifact.size_in_bytes=16385,f=>f.records[2].artifacts.push({...f.artifact}),f=>f.records[2].total_count=2,f=>f.overrides.set(3,Buffer.from('fixture-private-script')),f=>f.overrides.set(4,Buffer.from('fixture-private-workflow'))]){const f=fixture();mutate(f);await reject(f);}
});
test('readonly fetches reject401, unknown statuses, redirects, oversized/invalid bodies and transport errors without raw details',async()=>{
 for(const status of [0,201,206,301,401,403,404,429,500]){const f=fixture();f.overrides.set(0,{response:{status,ok:true}});await reject(f);}
 for(const response of [{redirected:true},{url:'https://fixture.invalid/private'}]){const f=fixture();f.overrides.set(0,{response});await reject(f);}
 for(const body of [Buffer.from('fixture-private-canary'),Buffer.alloc(65537,65),{throw:true}]){const f=fixture();f.overrides.set(0,body);await reject(f);}
 const duplicate=fixture();duplicate.overrides.set(0,JSON.stringify(duplicate.run).replace('"id":1002','"id":1,"id":1002'));await reject(duplicate);
});
test('ZIP path/entry/CRC/header/Zip64 and trailing ambiguity are rejected before JSON admission',()=>{
 const name='password-task-retention-proof.json',bytes=resultBytes(),good=zip();
 const malformed=[Buffer.concat([good,Buffer.from('x')]),zip([{name:'../'+name,bytes}]),zip([{name,localName:'different.json',bytes}]),zip([{name,bytes},{name,bytes}]),zip([{name,bytes},{name:'extra.txt',bytes:Buffer.from('x')}]),zip([{name,bytes,externalAttr:0xa1ff0000}]),zip([{name,bytes,packedSuffix:Buffer.from('hidden')}])];
 for(const mutate of [b=>{const offset=b.readUInt32LE(b.length-22+16);b.writeUInt32LE(0,offset+16);b.writeUInt32LE(0,offset-12);},b=>b.writeUInt16LE(1,6),b=>b.writeUInt32LE(1,b.length-22+4),b=>b.writeUInt16LE(45,4),b=>b.writeUInt32LE(0xffffffff,b.readUInt32LE(b.length-22+16)+20),b=>b[b.readUInt32LE(b.length-22+16)+16]^=1,b=>b[b.readUInt32LE(b.length-22+16)-12]^=1]){const value=Buffer.from(good);mutate(value);malformed.push(value);}
 for(const value of malformed)assert.throws(()=>read(value),error=>error.message==='ROTATION_CUTOVER_PROOF_ARCHIVE_REJECTED');
 assert.throws(()=>read(Buffer.alloc(16385)),/ROTATION_CUTOVER_PROOF_ARCHIVE_REJECTED/);
 const bomb=zip([{name,bytes:Buffer.from(' '.repeat(16385))}]);assert.ok(bomb.length<16384);assert.throws(()=>read(bomb),/ROTATION_CUTOVER_PROOF_ARCHIVE_REJECTED/);
});
test('JSON writer boundary rejects duplicate/noncanonical/trailing/nonfinite forms and never copies discarded canaries',()=>{
 const wire=JSON.stringify(successResult()),forms=['\uFEFF\uFEFF'+wire+'\r\n',' '+wire,wire+'\n\n',wire+'\r\nfixture-private-canary',wire.replace('"complete":true','"complete":false,"complete":true'),wire.replace('"profileCleanupState":"REMOVED_AND_ABSENT_CONFIRMED"','"profileCleanupState":"fixture-private-canary","profileCleanupState":"REMOVED_AND_ABSENT_CONFIRMED"'),wire.replace('"schemaVersion":3','"schemaVersion":3.0'),wire.replace('"schemaVersion":3','"schemaVersion":NaN'),JSON.stringify([successResult()])];
 for(const value of forms)assert.throws(()=>read(zip([{name:'password-task-retention-proof.json',bytes:Buffer.from(value)}])),error=>error.message==='ROTATION_CUTOVER_PROOF_ARCHIVE_REJECTED');
});
