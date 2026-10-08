import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {Buffer} from 'node:buffer';
import {tmpdir} from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfaceFingerprint, enumerateSurfaces, validateReverseTraceability, validateOwnerDecisions } from '../scripts/jarvis-requirement-audit.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const matrix=JSON.parse(fs.readFileSync(path.join(root,'docs/jarvis-requirements.json'),'utf8'));
const ledger=fs.readFileSync(path.join(root,'docs/JARVIS_PRODUCT_SPEC.md'),'utf8');
const report=()=>JSON.parse(fs.readFileSync(path.join(root,'docs/jarvis-reverse-traceability.json'),'utf8'));
const decisions=()=>JSON.parse(fs.readFileSync(path.join(root,'docs/jarvis-owner-decisions.json'),'utf8'));
test('actual product surfaces are explicitly reconciled and accepted decisions are spec-synced',()=>{
 assert.deepEqual(validateReverseTraceability(report(),matrix,root),[]);
 assert.deepEqual(validateOwnerDecisions(decisions(),matrix,ledger,root),[]);
});
test('new, duplicate, removed and content-stale production surfaces fail visible',()=>{
 const r=report(),files=enumerateSurfaces(root);assert.ok(files.length>300);
 const target=r.surfaces.find(x=>x.classification==='COVERED_BY_REQUIREMENT');assert.ok(target);
 const missing=globalThis.structuredClone(r);missing.surfaces=missing.surfaces.filter(x=>x.path!==target.path);assert.match(validateReverseTraceability(missing,matrix,root).join(' '),/unmapped surface/);
 const duplicate=globalThis.structuredClone(r);duplicate.surfaces.push(target);assert.match(validateReverseTraceability(duplicate,matrix,root).join(' '),/duplicate/);
 const stale=globalThis.structuredClone(r);stale.surfaces.find(x=>x.path===target.path).sha256='0'.repeat(64);assert.match(validateReverseTraceability(stale,matrix,root).join(' '),/changed surface/);
 const retired=globalThis.structuredClone(r);retired.surfaces.push({...target,path:'src/jarvis/removed-fixture.ts'});assert.match(validateReverseTraceability(retired,matrix,root).join(' '),/absent surface/);
});
test('coverage cannot use unknown parents, path escape or empty exclusion reasons',()=>{
 const r=report();r.surfaces[0].requirement_ids=['INVENTED-999'];assert.match(validateReverseTraceability(r,matrix,root).join(' '),/unknown parent/);
 const escape=report();escape.surfaces[0].path='../outside';assert.match(validateReverseTraceability(escape,matrix,root).join(' '),/unsafe path/);
 const exclusion=report();exclusion.surfaces[0].classification='EXCLUDED';exclusion.surfaces[0].reason='';assert.match(validateReverseTraceability(exclusion,matrix,root).join(' '),/reason/);
});
test('accepted owner decisions cannot be done without canonical sync and mirror equality',()=>{
 const d=decisions();d.decisions[0].state='ACCEPTED_REQUIREMENT';assert.match(validateOwnerDecisions(d,matrix,ledger,root).join(' '),/unsynced accepted/);
 const m=globalThis.structuredClone(matrix);m.requirements[0].title+=' drift';assert.match(validateOwnerDecisions(decisions(),m,ledger,root).join(' '),/Canonical ledger and matrix differ/);
});
test('examples and external data never become owner authority; unsupported VERIFIED cannot pass',()=>{
 for(const field of ['kind','decision']){const d=decisions();d.decisions[0].source[field]=field==='kind'?'external_document':'example';assert.match(validateOwnerDecisions(d,matrix,ledger,root).join(' '),/explicit owner acceptance/);}
 const d=decisions();d.decisions[0].state='VERIFIED';assert.match(validateOwnerDecisions(d,matrix,ledger,root).join(' '),/unverified canonical/);
});
test('supersede history is reciprocal, retained and acyclic; protected changes need a separate gate',()=>{
 const d=decisions();d.decisions[0].supersedes=['missing'];assert.match(validateOwnerDecisions(d,matrix,ledger,root).join(' '),/supersede/);
 const protectedChange=decisions();protectedChange.decisions[0].protected_changes=['permissions'];assert.match(validateOwnerDecisions(protectedChange,matrix,ledger,root).join(' '),/protected change/);
});

test('canonical source hashes tolerate Git CRLF checkouts but detect content changes',()=>{
 assert.equal(surfaceFingerprint(Buffer.from('one\r\ntwo\r\n')),surfaceFingerprint(Buffer.from('one\ntwo\n')));
 assert.notEqual(surfaceFingerprint(Buffer.from('one\ntwo\n')),surfaceFingerprint(Buffer.from('one\nthree\n')));
 assert.notEqual(surfaceFingerprint(Buffer.from([0,13,10])),surfaceFingerprint(Buffer.from([0,10])));
});
test('accepted history cannot be deleted or downgraded behind existing canonical links',()=>{
 const empty=decisions();empty.decisions=[];assert.match(validateOwnerDecisions(empty,matrix,ledger,root).join(' '),/missing source decision history/);
 const idea=decisions();idea.decisions[0].state='IDEA';assert.match(validateOwnerDecisions(idea,matrix,ledger,root).join(' '),/lacks adopted decision/);
 const tampered=decisions();tampered.decisions[0].source.excerpt+='changed';assert.match(validateOwnerDecisions(tampered,matrix,ledger,root).join(' '),/hash mismatch/);
});

test('production routes named test and non-code test assets remain in the inventory',()=>{
 const dir=fs.mkdtempSync(path.join(tmpdir(),'jarvis-audit-fixture-'));
 try{fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'src/app/api/jarvis/test'),{recursive:true});fs.writeFileSync(path.join(dir,'src/app/api/jarvis/test/route.ts'),'export const GET=()=>null;');fs.writeFileSync(path.join(dir,'src/app/api/jarvis/test/payload.test.json'),'{}');fs.writeFileSync(path.join(dir,'src/app/api/jarvis/test/helper.test.ts'),'test fixture');
 assert.deepEqual(enumerateSurfaces(dir),['src/app/api/jarvis/test/payload.test.json','src/app/api/jarvis/test/route.ts']);
 }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
test('exclusion requires a resolvable repository reference or approved issue URL',()=>{
 for(const ref of ['does-not-exist.md','../outside','https://unrelated.invalid/']){const r=report();const row=r.surfaces.find(x=>x.classification==='EXCLUDED');row.exclusion_ref=ref;assert.match(validateReverseTraceability(r,matrix,root).join(' '),/invalid exclusion source/);}
});
