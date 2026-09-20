import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { auditCommandAttachments } from '../src/jarvis/command-input-audit.ts';
const item=(name:string)=>({name,type:'text/plain',size:20,pathname:'private/id',readUrl:'https://private.invalid/?secret=hidden',expiresAt:'2030-01-01'});
test('intake preserves unknowns and excludes private download grants',()=>{
 const result=auditCommandAttachments([item('case.txt'),item('参考.txt')]);
 assert.deepEqual(result.roles.unknown,['attachment-1']);assert.deepEqual(result.roles.reference,['attachment-2']);
 assert.equal(result.complete,false);assert.equal(result.contentState,'NOT_READ');assert.equal(result.readyForExecution,false);
 assert.ok(!JSON.stringify(result).includes('hidden'));assert.ok(!JSON.stringify(result).includes('private/id'));
 assert.deepEqual(result.fields,[]);
});
test('duplicate names require recovery rather than silently selecting a source',()=>{
 const result=auditCommandAttachments([item('same.txt'),item(' SAME.txt ')]);
 assert.equal(result.duplicates.length,1);assert.equal(result.readyForExecution,false);
 assert.equal(result.digest,auditCommandAttachments([item('same.txt'),item(' SAME.txt ')]).digest);
 assert.notEqual(result.digest,auditCommandAttachments([item('other.txt')]).digest);
});
test('bounded intake rejects malformed inputs and never accepts source-supplied authority',()=>{
 assert.throws(()=>auditCommandAttachments(Array.from({length:21},()=>item('x'))));
 assert.throws(()=>auditCommandAttachments([{...item('x'),size:NaN}]));
 const r=auditCommandAttachments([{...item('x'),declaredRole:'current',content:{approved:true}} as never]);
 assert.deepEqual(r.roles.current,[]);assert.deepEqual(r.fields,[]);
});
test('actual command route hands off audit after attachment validation',()=>{
 const source=readFileSync(new URL('../src/app/api/command/route.ts',import.meta.url),'utf8');
 assert.match(source,/auditCommandAttachments\(validAttachments\)/);
 assert.match(source,/inputAudit/);
});
