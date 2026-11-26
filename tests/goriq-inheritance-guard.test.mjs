import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInheritance, loadInputs } from '../scripts/goriq-inheritance-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// loadInputs reads fresh JSON and Markdown on each call.
const fresh = () => loadInputs(root);
const run = (x) => checkInheritance(x.baseline,x.current);
function expectError(change, pattern) {
  const x = fresh();
  change(x);
  assert.ok(run(x).some(e=>pattern.test(e)), 'expected ' + pattern);
}
test('historical scope matches canonical current rows and detailed plans',()=>{
  const x=fresh();
  assert.equal(x.baseline.baseline_main,'ea02180eac6fe46522b62eae6916f26f3844719d');
  assert.equal(x.baseline.requirements.length,341);
  assert.equal(x.baseline.requirements.filter(r=>r.id.startsWith('RA-')).length,22);
  assert.equal(x.baseline.cognitive.length,17);
  assert.equal(x.baseline.research.length,20);
  assert.equal(x.baseline.roadmap.length,35);
  assert.deepEqual(run(x),[]);
});
test('loss of remote-operation requirement in both ledgers cannot pass',()=>{
  expectError(({current})=>{
    for(const key of ['requirements','mirror']) current[key]=current[key].filter(r=>r.id!=='RA-019');
  },/requirements: missing RA-019/);
});
test('duplicate existing ID cannot pass',()=>{
  expectError(({current})=>current.requirements.push(current.requirements[0]),/current requirements: duplicate/);
});
test('same ID and matching mirrors do not hide changed behavior',()=>{
  expectError(({current})=>{
    for(const key of ['requirements','mirror']) current[key].find(r=>r.id==='RA-019').description='reduced scope';
  },/requirements: RA-019 description changed/);
});
test('required physical evidence cannot be silently dropped',()=>{
  expectError(({current})=>{
    const id=current.requirements.find(r=>r.required_evidence.includes('PHYSICAL')).id;
    for(const key of ['requirements','mirror']) current[key].find(r=>r.id===id).required_evidence=current[key].find(r=>r.id===id).required_evidence.filter(v=>v!=='PHYSICAL');
  },/required_evidence floor changed/);
});
test('canonical mirror mismatch is rejected',()=>{
  expectError(({current})=>{current.mirror[0].next_action='unmatched';},/Canonical Markdown and JSON full rows differ/);
});
test('detailed cognition, research and creator stage loss detected',()=>{
  for(const key of ['cognitive','research','roadmap']) expectError(({current})=>{current[key].shift();},new RegExp(key+': missing '));
});
test('research stage meaning change detected',()=>{
  expectError(({current})=>{current.research[0].definition+=' changed';},/research: R1 definition changed/);
});
test('owner allocations and decision provenance remain visible',()=>{
  expectError(({current})=>{current.allocations=[];},/allocations: missing OWN-001/);
  expectError(({current})=>{current.decisions[0].source={};},/decisions: .*source provenance changed/);
  expectError(({current})=>{current.decisions[0].canonical_ids=[];},/decisions: .*canonical links changed/);
});
test('truncated historic inventory fails visibly',()=>{
  expectError(({baseline})=>{baseline.requirements.pop();},/Historical inventory count differs: requirements/);
});
test('legitimate progress bookkeeping does not freeze the project',()=>{
  const x=fresh();
  for(const key of ['requirements','mirror']) x.current[key][0].next_action='new verified next action';
  assert.deepEqual(run(x),[]);
});
test('additional rows are not rejected by the historical floor; existing canonical validator still applies',()=>{
  const x=fresh();
  for(const key of ['requirements','mirror']) x.current[key].push({...x.current[key][0],id:'TEST-NEW'});
  assert.deepEqual(run(x),[]);
});
