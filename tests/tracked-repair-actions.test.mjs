import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,createPublicKey} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {gzipSync,brotliCompressSync,brotliDecompressSync,constants as zlibConstants} from 'node:zlib';
import {FIXED_ROOT,validateCheckpoint,encodeCheckpoint,decodeCheckpoint} from '../scripts/jarvis-tracked-repair-actions.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const head='1'.repeat(40),base='2'.repeat(40),revision='3'.repeat(64),artifact='4'.repeat(64);
// Published RFC8032 public test vector, never a generated/private credential.
const publicPem=createPublicKey({key:Buffer.from('302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex'),format:'der',type:'spki'}).export({format:'pem',type:'spki'}).toString();
const source='export const answer = 42;\n',probe="import assert from 'node:assert/strict'; assert.equal(42,42);\n";
function file(path,bytes){bytes=Buffer.from(bytes);return {path,sha256:hash(bytes),contentBase64:bytes.toString('base64')};}
function update(cp,path,bytes){const index=cp.files.findIndex(f=>f.path===path);assert.notEqual(index,-1);cp.files[index]=file(path,bytes);}
function manifest(cp){return JSON.parse(Buffer.from(cp.files.find(f=>f.path==='manifest.json').contentBase64,'base64'));}
function replaceManifest(cp,m){
  const bytes=JSON.stringify(m);update(cp,'manifest.json',bytes);cp.manifestSha256=hash(bytes);
  const outboxPath='receipt.json.request.json',outbox=JSON.parse(Buffer.from(cp.files.find(f=>f.path===outboxPath).contentBase64,'base64'));
  outbox.executionContractDigest=cp.manifestSha256;outbox.expiresAt=m.sequence.expiresAt;update(cp,outboxPath,JSON.stringify(outbox));
  for(const record of cp.files.filter(f=>f.path.endsWith('.prepared.json')||f.path.endsWith('.prepared.json.intent.json'))){
    const value=JSON.parse(Buffer.from(record.contentBase64,'base64'));value.binding=hash(cp.manifestSha256+'\0'+cp.jobId);update(cp,record.path,JSON.stringify(value));
  }
  const jobsPath='state/self-development/jobs.json',snapshot=JSON.parse(Buffer.from(cp.files.find(f=>f.path===jobsPath).contentBase64,'base64'));
  snapshot.jobs[0].approvalScope.expiresAt=m.sequence.expiresAt;update(cp,jobsPath,JSON.stringify(snapshot));
}
function fixture(){
  const goalId='goal-1219-fixture',jobId='job-1219-fixture',changeSetId=jobId+':tracked-candidate';
  const expiresAt=new Date(Date.now()+3600000).toISOString(),at=new Date().toISOString();
  const m={version:1,profile:'tracked-source-repair-v1',sequence:{version:1,goalDigest:'5'.repeat(64),taskScopeId:'issue:1219',maxRisk:'low',completionMode:'verified-local-artifact',expiresAt,
    jobs:[{key:'repair',objective:'Repair the frozen source regression',criterionIds:['criterion-1'],targetFiles:['scripts/logic.mjs','tests/frozen.test.mjs'],baseRevision:base}]},
    workspace:FIXED_ROOT+'/candidate',baselineWorkspace:FIXED_ROOT+'/baseline',targetPath:'scripts/logic.mjs',trackedFiles:[{path:'scripts/logic.mjs',beforeSha256:hash('export const answer = 0;\n')}],slots:[{id:1,path:'scripts/logic.mjs',before:'0'}],
    probe:{file:FIXED_ROOT+'/frozen-probe.mjs',sha256:hash(probe),targetPath:'tests/frozen.test.mjs',expectedRedText:'0 !== 42'},
    model:{endpoint:'http://127.0.0.1:11435/completion',id:'fixture-model',sha256:'6'.repeat(64),nPredict:512,timeoutMs:5000},
    verifier:{publicKeyFile:FIXED_ROOT+'/public.pem',publicKeySha256:hash(publicPem),receiptFile:FIXED_ROOT+'/receipt.json'}};
  const manifestText=JSON.stringify(m),manifestSha256=hash(manifestText),binding=hash(manifestSha256+'\0'+jobId),journal='state/self-development/tracked-repair/'+hash(jobId);
  const job={version:1,jobId,goalId,requirementIds:['CORE-014'],acceptanceCriteria:['criterion-1'],definitionOfDone:[{id:'criterion-1',description:'Frozen test passes',required:true}],baseRevision:base,
    approvalScope:{taskScopeId:'issue:1219',maxRisk:'low',expiresAt},workItems:[{id:jobId+':implement',objective:'Repair frozen source regression',dependsOn:[],requiredCapabilities:['code.builder']}],phase:'VERIFYING',evidence:[],attempts:[],failureSignatures:[],rejectedStrategyIds:[],blockers:[],createdAt:at,updatedAt:at,history:[]};
  const change={version:1,changeSetId,jobId,workItemId:jobId+':implement',deviceId:'local-tracked-model-builder',baseRevision:base,candidateRevision:revision,changedPaths:['scripts/logic.mjs','tests/frozen.test.mjs'],affectedSymbols:[],patchDigest:'7'.repeat(64),artifactDigest:artifact,artifactRef:'sha256:'+artifact,evidenceDigest:'8'.repeat(64),rollback:{kind:'git-base',reference:base},status:'LOCAL',createdAt:at,updatedAt:at};
  const outbox={version:2,kind:'tracked-repair-verifier-request',executionContractDigest:manifestSha256,expiresAt,request:{goalId,jobId,changeSetId,builderId:'local-tracked-model-builder',baseRevision:base,sourceRevision:revision,artifactDigest:artifact,targetPath:'scripts/logic.mjs',allowedUntracked:['tests/frozen.test.mjs'],trackedEdits:{version:2,files:[{path:'scripts/logic.mjs',beforeSha256:m.trackedFiles[0].beforeSha256,afterSha256:hash(source)}]},requiredChecks:['lint','typecheck','unit','integration','security','build']}};
  return {version:1,kind:'tracked-repair-actions-checkpoint',head,phase:'cloud',sourceRunId:null,manifestSha256,goalId,jobId,changeSetId,files:[
    file('manifest.json',manifestText),file('public.pem',publicPem),file('frozen-probe.mjs',probe),file('state/compass.sqlite','SQLite format 3\0fixture bytes; structural test only'),
    file('state/self-development/jobs.json',JSON.stringify({version:1,jobs:[job],savedAt:at})),file('state/self-development/change-sets.json',JSON.stringify({version:1,changeSets:[change],savedAt:at})),
    file('receipt.json.request.json',JSON.stringify(outbox)),file(journal+'.prepared.json',JSON.stringify({binding,files:[{path:'scripts/logic.mjs',content:source}],responseSha256:'9'.repeat(64),promptSha256:'a'.repeat(64)})),
    file(journal+'.prepared.json.intent.json',JSON.stringify({binding,workItemId:jobId+':implement',prompt:'Fixture prompt only'})),
    file(journal+'.prepared.json.response.json',JSON.stringify({model:'fixture-model',stop:true,truncated:false,stop_type:'eos',content:'fixture response'})),
    file('candidate/scripts/logic.mjs',source),file('candidate/tests/frozen.test.mjs',probe)]};
}

test('checkpoint roundtrip preserves the exact accepted Job and candidate bytes',()=>{
  const cp=fixture();assert.doesNotThrow(()=>validateCheckpoint(cp,{expectedHead:head}));
  const encoded=encodeCheckpoint(cp);assert.ok(encoded.b64.length<=64000);assert.equal(hash(Buffer.from(encoded.b64,'base64')),encoded.sha256);
  assert.deepEqual(decodeCheckpoint(encoded.b64,encoded.sha256),cp);
});

test('checkpoint refuses path escape and secret or Git metadata files before restore',()=>{
  for(const path of ['../outside.txt','/tmp/outside.txt','candidate/.git/config','private.pem','owner-token','candidate/scripts/../../escape.mjs']){
    const cp=fixture();cp.files.push(file(path,'forbidden bytes'));
    assert.throws(()=>validateCheckpoint(cp,{expectedHead:head}),undefined,path);
  }
});

test('checkpoint rejects expired approval even when every file hash matches',()=>{
  const cp=fixture(),m=manifest(cp);m.sequence.expiresAt='2000-01-01T00:00:00.000Z';replaceManifest(cp,m);
  assert.throws(()=>validateCheckpoint(cp,{expectedHead:head}));
});

test('checkpoint refuses source head changes and modified candidate bytes',()=>{
  const wrongHead=fixture();assert.throws(()=>validateCheckpoint(wrongHead,{expectedHead:'f'.repeat(40)}));
  const tampered=fixture();tampered.files.find(f=>f.path==='candidate/scripts/logic.mjs').contentBase64=Buffer.from('export const answer = 43;\n').toString('base64');
  assert.throws(()=>validateCheckpoint(tampered,{expectedHead:head}));
});

test('checkpoint rejects a different durable Job or Change Set rather than importing parallel work',()=>{
  for(const key of ['goalId','jobId','changeSetId']){const cp=fixture();cp[key]+='-other';assert.throws(()=>validateCheckpoint(cp,{expectedHead:head}),undefined,key);}
});

test('checkpoint phase B requires an actual phase A origin and refuses replay as a new bootstrap',()=>{
  const cloud=fixture();assert.throws(()=>validateCheckpoint(cloud,{expectedHead:head,phase:'B'}));
  const a=fixture();a.phase='A';a.sourceRunId='1234567';assert.doesNotThrow(()=>validateCheckpoint(a,{expectedHead:head,phase:'B'}));
  assert.throws(()=>validateCheckpoint(a,{expectedHead:head,phase:'A'}));a.sourceRunId=null;assert.throws(()=>validateCheckpoint(a,{expectedHead:head,phase:'B'}));
});

test('checkpoint refuses private PEM material even inside an otherwise allowed source or journal',()=>{
  const cp=fixture(),content=source+'// -----BEGIN RSA PRIVATE KEY----- fixture sentinel only\n';
  update(cp,'candidate/scripts/logic.mjs',content);
  const prepared=cp.files.find(f=>f.path.endsWith('.prepared.json')),record=JSON.parse(Buffer.from(prepared.contentBase64,'base64'));
  record.files[0].content=content;update(cp,prepared.path,JSON.stringify(record));
  assert.throws(()=>validateCheckpoint(cp,{expectedHead:head}));
});

test('checkpoint refuses bound-request candidate identity drift and prepared source mismatch',()=>{
  const cp=fixture(),requestPath='receipt.json.request.json',request=JSON.parse(Buffer.from(cp.files.find(f=>f.path===requestPath).contentBase64,'base64'));
  request.request.sourceRevision='f'.repeat(64);update(cp,requestPath,JSON.stringify(request));assert.throws(()=>validateCheckpoint(cp,{expectedHead:head}));
  const prepared=fixture(),record=prepared.files.find(f=>f.path.endsWith('.prepared.json')),value=JSON.parse(Buffer.from(record.contentBase64,'base64'));
  value.files[0].content='export const answer = 999;\n';update(prepared,record.path,JSON.stringify(value));assert.throws(()=>validateCheckpoint(prepared,{expectedHead:head}));
});

test('checkpoint decoding rejects transport tampering and oversized data',()=>{
  const encoded=encodeCheckpoint(fixture());assert.throws(()=>decodeCheckpoint(encoded.b64,'0'.repeat(64)));
  const cp=fixture(),content=source+'/*'+Array.from({length:1000},(_,i)=>hash(String(i))).join('')+'*/\n';
  update(cp,'candidate/scripts/logic.mjs',content);
  const prepared=cp.files.find(f=>f.path.endsWith('.prepared.json')),record=JSON.parse(Buffer.from(prepared.contentBase64,'base64'));
  record.files[0].content=content;update(cp,prepared.path,JSON.stringify(record));
  assert.doesNotThrow(()=>validateCheckpoint(cp,{expectedHead:head}));
  const bytes=gzipSync(Buffer.from(JSON.stringify(cp))),b64=bytes.toString('base64');assert.ok(b64.length>64000);
  assert.throws(()=>encodeCheckpoint(cp));assert.throws(()=>decodeCheckpoint(b64,hash(bytes)));
});

test('checkpoint admits exact pinned traceability bookkeeping and refuses any other docs target',()=>{
  const cp=fixture(),m=manifest(cp),path='docs/jarvis-reverse-traceability.json';
  const before='{"surfaces":[{"path":"scripts/logic.mjs","sha256":"before"}]}\n';
  const content=JSON.stringify({surfaces:[{path:'scripts/logic.mjs',sha256:hash(source)}]})+'\n';
  m.bookkeeping={path,beforeSha256:hash(before)};m.sequence.jobs[0].targetFiles.push(path);cp.files.push(file('candidate/'+path,content));
  const prepared=cp.files.find(f=>f.path.endsWith('.prepared.json')),record=JSON.parse(Buffer.from(prepared.contentBase64,'base64'));
  record.files.push({path,content});update(cp,prepared.path,JSON.stringify(record));
  const outboxPath='receipt.json.request.json',outbox=JSON.parse(Buffer.from(cp.files.find(f=>f.path===outboxPath).contentBase64,'base64'));
  outbox.request.trackedEdits.files.push({path,beforeSha256:hash(before),afterSha256:hash(content)});update(cp,outboxPath,JSON.stringify(outbox));
  replaceManifest(cp,m);assert.doesNotThrow(()=>validateCheckpoint(cp,{expectedHead:head}));
  const other='docs/owner-policy.json';m.bookkeeping.path=other;m.sequence.jobs[0].targetFiles=m.sequence.jobs[0].targetFiles.map(p=>p===path?other:p);
  cp.files.find(f=>f.path==='candidate/'+path).path='candidate/'+other;
  record.files.find(f=>f.path===path).path=other;update(cp,prepared.path,JSON.stringify(record));
  outbox.request.trackedEdits.files.find(f=>f.path===path).path=other;update(cp,outboxPath,JSON.stringify(outbox));replaceManifest(cp,m);
  assert.throws(()=>validateCheckpoint(cp,{expectedHead:head}));
});

test('checkpoint uses bounded Brotli fallback for duplicate nonsecret payload bytes',()=>{
  const cp=fixture(),m=manifest(cp),path='docs/jarvis-reverse-traceability.json';
  // Compression characterization only; this does not represent the real map.
  const block=Array.from({length:387},(_,i)=>hash('duplicate-fixture-'+i)).join('');
  const content=JSON.stringify({schema_version:1,notes:block.repeat(8)});
  m.bookkeeping={path,beforeSha256:hash('original traceability bytes')};m.sequence.jobs[0].targetFiles.push(path);cp.files.push(file('candidate/'+path,content));
  const prepared=cp.files.find(f=>f.path.endsWith('.prepared.json')),record=JSON.parse(Buffer.from(prepared.contentBase64,'base64'));
  record.files.push({path,content});update(cp,prepared.path,JSON.stringify(record));
  const outboxPath='receipt.json.request.json',outbox=JSON.parse(Buffer.from(cp.files.find(f=>f.path===outboxPath).contentBase64,'base64'));
  outbox.request.trackedEdits.files.push({path,beforeSha256:m.bookkeeping.beforeSha256,afterSha256:hash(content)});
  update(cp,outboxPath,JSON.stringify(outbox));replaceManifest(cp,m);
  assert.doesNotThrow(()=>validateCheckpoint(cp,{expectedHead:head}));
  const raw=Buffer.from(JSON.stringify(cp)),gzipSize=gzipSync(raw).toString('base64').length;
  const brotliSize=brotliCompressSync(raw,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:5,[zlibConstants.BROTLI_PARAM_LGWIN]:22}}).toString('base64').length;
  assert.ok(gzipSize>60000);assert.ok(brotliSize<=60000,'gzip='+gzipSize+', brotli='+brotliSize);
  const encoded=encodeCheckpoint(cp);assert.ok(encoded.b64.length<=60000);assert.notEqual(Buffer.from(encoded.b64,'base64').subarray(0,2).toString('hex'),'1f8b');
  assert.deepEqual(decodeCheckpoint(encoded.b64,encoded.sha256),cp);
});

test('fixed-map transport reconstructs exact realistic metadata from the pinned baseline and refuses a different baseline',()=>{
  const cp=fixture(),m=manifest(cp),path='docs/jarvis-reverse-traceability.json';
  const surfaces=Array.from({length:613},(_,i)=>({path:i===0?'scripts/logic.mjs':'src/orchestrator/fixture-surface-'+i+'.ts',
    sha256:i===0?m.trackedFiles[0].beforeSha256:hash('actual-shape-surface-'+i),classification:'COVERED_BY_REQUIREMENT',requirement_ids:['CORE-014','AUTO-001','AUTO-004','GOV-025'],
    reason:'Host-pinned verification and durable recovery preserve permission boundaries; implementation mapping only.'}));
  const beforeMap={schema_version:1,source_main:base,hash_policy:'utf8-crlf-to-lf-v1;binary-raw',surfaces};
  const baseline=Buffer.from(JSON.stringify(beforeMap,null,2)+'\n'),afterMap=JSON.parse(JSON.stringify(beforeMap));afterMap.surfaces[0].sha256=hash(source);
  const content=JSON.stringify(afterMap,null,2)+'\n';
  m.bookkeeping={path,beforeSha256:hash(baseline)};m.sequence.jobs[0].targetFiles.push(path);cp.files.push(file('candidate/'+path,content));
  const prepared=cp.files.find(f=>f.path.endsWith('.prepared.json')),record=JSON.parse(Buffer.from(prepared.contentBase64,'base64'));
  record.files.push({path,content});update(cp,prepared.path,JSON.stringify(record));
  const outboxPath='receipt.json.request.json',outbox=JSON.parse(Buffer.from(cp.files.find(f=>f.path===outboxPath).contentBase64,'base64'));
  outbox.request.trackedEdits.files.push({path,beforeSha256:hash(baseline),afterSha256:hash(content)});
  outbox.files=[{path:'scripts/logic.mjs',sha256:hash(source),contentBase64:Buffer.from(source).toString('base64')},
    {path:m.probe.targetPath,sha256:hash(probe),contentBase64:Buffer.from(probe).toString('base64')},
    {path,sha256:hash(content),contentBase64:Buffer.from(content).toString('base64')}];
  update(cp,outboxPath,JSON.stringify(outbox));replaceManifest(cp,m);
  assert.doesNotThrow(()=>validateCheckpoint(cp,{expectedHead:head}));
  const raw=Buffer.from(JSON.stringify(cp)),fullBrotli=brotliCompressSync(raw,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:5,[zlibConstants.BROTLI_PARAM_LGWIN]:22}});
  assert.ok(fullBrotli.toString('base64').length>60000,'unpacked realistic metadata must exceed dispatch capacity');
  const encoded=encodeCheckpoint(cp);assert.ok(encoded.b64.length<=60000);
  assert.deepEqual(decodeCheckpoint(encoded.b64,encoded.sha256,{bookkeepingBaseline:baseline}),cp);
  const wire=JSON.parse(brotliDecompressSync(Buffer.from(encoded.b64,'base64')));assert.equal(wire.kind,'tracked-repair-actions-fixed-map');
  for(const target of ['candidate/'+path,prepared.path,outboxPath]){
    const changed=JSON.parse(JSON.stringify(wire));changed.checkpoint.files.find(row=>row.path===target).sha256='e'.repeat(64);
    const bytes=brotliCompressSync(Buffer.from(JSON.stringify(changed)),{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:5,[zlibConstants.BROTLI_PARAM_LGWIN]:22}});
    assert.throws(()=>decodeCheckpoint(bytes.toString('base64'),hash(bytes),{bookkeepingBaseline:baseline}),undefined,target);
  }
  const different=JSON.parse(JSON.stringify(beforeMap));different.surfaces[1].sha256='f'.repeat(64);
  assert.throws(()=>decodeCheckpoint(encoded.b64,encoded.sha256,{bookkeepingBaseline:Buffer.from(JSON.stringify(different,null,2)+'\n')}));
});

