import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,URL} from 'node:url';
import {buildCompletionAudit} from '../scripts/goriq-completion-audit.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const json=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const baseline={root,revision:'7c45c42aaaf06907b198763dfb634434b9a62fef',
  matrix:json('docs/jarvis-requirements.json'),ledger:fs.readFileSync(new URL('../docs/JARVIS_PRODUCT_SPEC.md',import.meta.url),'utf8'),
  inventory:json('docs/jarvis-additional-requirements.json'),decisions:json('docs/jarvis-owner-decisions.json'),
  reverse:json('docs/jarvis-reverse-traceability.json'),cognitive:json('docs/goriq-cognitive-status.json')};
const input=()=>globalThis.structuredClone(baseline);

test('rejects omitted or malformed cognitive stages and mapping arrays instead of dropping them',()=>{
  for(const field of ['states','implementation_refs','test_refs','evidence_refs']){
    for(const value of [undefined,null,'lost-mapping',[42],['']]){
      const b=input();if(value===undefined)delete b.cognitive.components[0][field];else b.cognitive.components[0][field]=value;
      assert.throws(()=>buildCompletionAudit(b),/COMPLETION_AUDIT_COGNITIVE_REJECTED/);
    }
  }
  const b=input();b.cognitive.components[0].states=['FABRICATED_ACCEPTANCE'];
  assert.throws(()=>buildCompletionAudit(b),/COMPLETION_AUDIT_COGNITIVE_REJECTED/);
});

test('binds the accepted additional-ID inventory as a hashed audit input',()=>{
  const a=buildCompletionAudit(input());
  assert.equal(a.sources.inventory,'docs/jarvis-additional-requirements.json');
  assert.match(a.source_sha256.inventory,/^[a-f0-9]{64}$/);
});

test('retains all canonical IDs and cognitive gaps without mutating or claiming completion',()=>{
  const b=input(), before=JSON.stringify(b), a=buildCompletionAudit(b);
  assert.equal(a.requirements.length,341);assert.equal(a.cognitive.length,17);
  assert.deepEqual(a.requirements.map(r=>r.id),b.matrix.requirements.map(r=>r.id));
  assert.deepEqual(a.cognitive.map(r=>r.remaining),b.cognitive.components.map(r=>r.remaining));
  assert.equal(a.product_complete,false);assert.equal(a.summary.incomplete,338);
  assert.equal(JSON.stringify(b),before);assert.deepEqual(a,buildCompletionAudit(b));
});

test('source presence for a MISSING requirement remains a lead rather than completion',()=>{
  const a=buildCompletionAudit(input());
  const r=a.requirements.find(r=>r.canonical_status==='MISSING'&&r.current_surface_refs.length>0);
  assert.ok(r,'real reverse mappings expose stale MISSING source metadata');
  assert.equal(r.acceptance,'BLOCKED');assert.ok(r.required_evidence.length>0);
  assert.equal(a.product_complete,false);
});

test('distinguishes actual evidence record IDs from missing file leads',()=>{
  const b=input();b.matrix.requirements[0].evidence_refs.push('docs/evidence/does-not-exist-for-audit.md');
  b.ledger=b.ledger.replace(/```json\r?\n[\s\S]*?\r?\n```/, '```json\n'+JSON.stringify(b.matrix.requirements[0],null,2)+'\n```');
  const a=buildCompletionAudit(b);
  const missing=a.requirements[0].evidence_leads.find(x=>x.ref==='docs/evidence/does-not-exist-for-audit.md');
  assert.equal(missing.kind,'MISSING_REPOSITORY_REFERENCE');
  const verified=a.requirements.find(x=>x.canonical_status==='VERIFIED');
  assert.ok(verified.evidence_leads.some(x=>x.kind==='EVIDENCE_RECORD'));
  assert.equal(verified.acceptance,'PASS_AT_CANONICAL_VERIFIED_COMMIT');
});

test('refuses deleted or duplicated requirements rather than silently shrinking scope',()=>{
  for(const mutate of [b=>b.matrix.requirements.pop(),b=>b.matrix.requirements.push(b.matrix.requirements[0])]){
    const b=input();mutate(b);assert.throws(()=>buildCompletionAudit(b),/COMPLETION_AUDIT_CANONICAL_REJECTED/);
  }
});

test('refuses lost or blank cognitive remaining contracts',()=>{
  for(const mutate of [b=>b.cognitive.components.pop(),b=>b.cognitive.components[0].remaining='',b=>b.cognitive.components[1].id=b.cognitive.components[0].id]){
    const b=input();mutate(b);assert.throws(()=>buildCompletionAudit(b),/COMPLETION_AUDIT_COGNITIVE_REJECTED/);
  }
});

test('includes latest accepted owner changes and phase ownership on every row',()=>{
  const b=input(),a=buildCompletionAudit(b);
  const d=b.decisions.decisions.find(d=>d.id==='owner-2026-10-06-goriq-design-session');
  assert.ok(d);for(const link of d.canonical)assert.ok(a.requirements.find(r=>r.id===link.id).source_decisions.includes(d.id));
  for(const r of a.requirements){assert.match(r.phase,/^P(?:[0-9]|10)$/);assert.ok(r.owner_issues.includes(681));assert.ok(r.next_action.trim());}
});
