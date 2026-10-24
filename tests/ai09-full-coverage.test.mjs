import test from 'node:test';
import assert from 'node:assert/strict';
import { planFullCoverage, verifyFullCoverageReceipts } from '../src/orchestrator/ai09-full-coverage.mjs';

const B = 'a'.repeat(40), H = 'b'.repeat(40);
function fixture(n = 203) {
  const files = Array.from({ length:n }, (_,i) => ({ path:'src/proof/file-' + String(i).padStart(3,'0') + '.mjs',
    status:'added', before:null, after:Buffer.from('export const proof' + i + ' = ' + i + ';\n') }));
  return { baseSha:B, headSha:H, files, expectedPaths:files.map(x => x.path) };
}
function receipts(plan) {
  const m = plan.manifest;
  return m.shards.map(s => ({ shardId:s.id, shardDigest:s.digest,
    manifestSha256:m.manifestSha256, baseSha:m.baseSha, headSha:m.headSha,
    reviewerId:'IndependentAI09', status:'NO_ACTIONABLE_FINDINGS' }));
}
test('all 203 files have unique byte-exact slices with bounded shards and a digest', () => {
  const p = planFullCoverage(fixture());
  const m = p.manifest;
  assert.equal(m.fileCount,203);
  assert.equal(m.files.length,203);
  assert.equal(new Set(m.files.map(f => f.path)).size,203);
  assert.equal(m.shards.reduce((n,s)=>n+s.sliceIds.length,0),203);
  assert.ok(m.shards.every(s=>s.sliceIds.length<=24 && s.fileCount<=30 && s.bytes<=120*1024));
  assert.equal(m.files.reduce((n,f)=>n+f.afterBytes+f.beforeBytes,0),m.totalBytes);
  assert.equal(verifyFullCoverageReceipts(m,receipts(p)).status,'NO_ACTIONABLE_FINDINGS');
  assert.equal(verifyFullCoverageReceipts(m,receipts(p)).githubApprovalSatisfied,false);
});
test('old/new bytes for rename, modify, add and delete are all covered', () => {
  const files=[
    {path:'renamed.mjs',previousPath:'old.mjs',status:'renamed',before:Buffer.from('old'),after:Buffer.from('new')},
    {path:'mod.mjs',status:'modified',before:Buffer.from('first'),after:Buffer.from('second')},
    {path:'added.mjs',status:'added',before:null,after:Buffer.from('new')},
    {path:'removed.mjs',status:'deleted',before:Buffer.from('gone'),after:null},
  ];
  const p=planFullCoverage({baseSha:B,headSha:H,files,expectedPaths:files.map(f=>f.path),maxSliceBytes:64});
  assert.equal(p.manifest.files.length,4);
  assert.deepEqual(p.manifest.files.map(f=>f.slices.map(s=>s.side)),[
    ['before','after'],['before','after'],['after'],['before']]);
  assert.equal(p.manifest.totalBytes,3+3+5+6+3+4);
});
test('oversized notice splits losslessly into 4KiB UTF8 slices', () => {
  const file={path:'THIRD_PARTY_NOTICE.md',status:'added',before:null,
    after:Buffer.from(('notice 🌱 and attribution\n').repeat(15000),'utf8')};
  const p=planFullCoverage({baseSha:B,headSha:H,files:[file],expectedPaths:[file.path]});
  const slices=p.manifest.files[0].slices;
  assert.ok(slices.length>24);
  assert.equal(Buffer.concat(slices.map(s=>Buffer.from(p.payloads.get(s.id)))).equals(file.after),true);
  assert.ok(slices.every(s=>s.end-s.start<=4096));
});
test('missing path, duplicate path, wrong scope and binary input fail closed',()=>{
  const f=fixture();
  assert.throws(()=>planFullCoverage({...f,expectedPaths:f.expectedPaths.slice(1)}));
  assert.throws(()=>planFullCoverage({...f,files:[...f.files,f.files[0]],expectedPaths:[...f.expectedPaths,'other.mjs']}));
  assert.throws(()=>planFullCoverage({...f,headSha:B}));
  assert.throws(()=>planFullCoverage({baseSha:B,headSha:H,files:[{path:'bin',status:'added',before:null,
    after:Buffer.from([0,1,2])}],expectedPaths:['bin']}),/BINARY/);
});
test('tampered, duplicate, stale, absent and incomplete review receipts never pass',()=>{
  const p=planFullCoverage(fixture());const r=receipts(p);
  assert.equal(verifyFullCoverageReceipts(p.manifest,r.slice(1)).status,'BLOCKED');
  assert.equal(verifyFullCoverageReceipts(p.manifest,[r[0],...r]).status,'BLOCKED');
  assert.equal(verifyFullCoverageReceipts(p.manifest,r.map((x,i)=>i?x:{...x,headSha:B})).status,'BLOCKED');
  assert.equal(verifyFullCoverageReceipts(p.manifest,r.map((x,i)=>i?x:{...x,shardDigest:'f'.repeat(64)})).status,'BLOCKED');
  assert.equal(verifyFullCoverageReceipts(p.manifest,r.map((x,i)=>i?x:{...x,reviewerId:'Builder'})).status,'BLOCKED');
  assert.equal(verifyFullCoverageReceipts(p.manifest,r.map((x,i)=>i?x:{...x,status:'INCONCLUSIVE'})).status,'INCONCLUSIVE');
  const altered=structuredClone(p.manifest);altered.files[0].afterBytes++;
  assert.equal(verifyFullCoverageReceipts(altered,r).status,'BLOCKED');
});
