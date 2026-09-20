import test from 'node:test';
import assert from 'node:assert/strict';
import {FactVerificationEngine} from '../src/jarvis/fact-verification.ts';
const claim={id:'c',text:'The count is 8',type:'numeric' as const,numericExpression:{expected:8}};
const source={id:'s',originId:'o',publisher:'p',sourceType:'primary' as const,retrievedAt:'2026-09-20',passage:'The count is 8',supports:['c']};
test('failed numeric verification cannot retain positive status',async()=>{const r=await new FactVerificationEngine(async()=>9).audit(claim,[source],Date.parse('2026-09-20'));assert.equal(r.status,'CONFLICTED');});
test('future dates and same-origin contradictions cannot provide positive certification',async()=>{
 const engine=new FactVerificationEngine(async()=>8);const now=Date.parse('2026-09-20');
 const future=await engine.audit(claim,[{...source,retrievedAt:'2027-09-20'}],now);assert.notEqual(future.status,'VERIFIED');
 const conflict=await engine.audit(claim,[source,{...source,id:'s2',contradicts:['c']}],now);assert.equal(conflict.status,'CONFLICTED');
});
