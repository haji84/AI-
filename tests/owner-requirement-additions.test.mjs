import {createHash} from "node:crypto";
import test from 'node:test';
import assert from 'node:assert/strict';
import {URL,fileURLToPath} from 'node:url';
import {CompassStore} from '../src/compass/store.ts';
import {OwnerRequirementIntake} from '../src/orchestrator/owner-requirement-intake.ts';
import {loadCanonicalBundle,prepareSpecificationProposal,verifyCanonicalReceipt} from '../scripts/jarvis-owner-spec-sync.mjs';
import {validateRequirements} from '../scripts/validate-jarvis-requirements.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('new adopted capability allocates independent ID and all four artifacts without changing frozen inventory',()=>{
 const db=new CompassStore(':memory:');try{
  const b=loadCanonicalBundle(root),intake=new OwnerRequirementIntake(db);
  const r=intake.capture(intake.prepare('add','new-feature',{decision:'accept',statement:'受け取った郵便の整理結果を一覧で確認できるようにする',canonicalIds:[]}),'goal',b.matrix.requirements);
  const p=prepareSpecificationProposal(r,b,{sourceRef:'https://github.com/haji84/AI-/issues/1205',bindings:[],newRequirement:{title:'郵便整理一覧',phase:'P7',baseInventorySha256:createHash('sha256').update(JSON.stringify(b.inventory)).digest('hex')}},root,intake.list());
  assert.deepEqual(p.files.map(f=>f.path),['docs/JARVIS_PRODUCT_SPEC.md','docs/jarvis-requirements.json','docs/jarvis-owner-decisions.json','docs/jarvis-additional-requirements.json']);
  const row=p.bundle.matrix.requirements.at(-1);assert.equal(row.id,'OWN-001');assert.equal(row.status,'MISSING');assert.equal(row.last_verified_commit,null);
  assert.deepEqual(p.bundle.matrix.requirements.slice(0,-1),b.matrix.requirements);
  assert.equal(verifyCanonicalReceipt(r,p.bundle,root).ok,true);
  const missing=globalThis.structuredClone(p.bundle);missing.matrix.requirements.pop();
  assert.match(validateRequirements(missing.matrix,missing.ledger,root,missing.inventory).join(' '),/OWN-001.*exactly once/);
  const weak=globalThis.structuredClone(p.bundle);weak.matrix.requirements.at(-1).required_evidence=['CODE'];
  assert.match(validateRequirements(weak.matrix,weak.ledger,root,weak.inventory).join(' '),/evidence.*removed|evidence.*floor/);
  const dup=globalThis.structuredClone(p.bundle);dup.inventory.allocations.push({...dup.inventory.allocations[0]});
  assert.ok(validateRequirements(dup.matrix,dup.ledger,root,dup.inventory).length);
  const second=intake.capture(intake.prepare('two','second',{decision:'accept',statement:r.statement,canonicalIds:[]}),'goal',p.bundle.matrix.requirements);
  assert.throws(()=>prepareSpecificationProposal(second,p.bundle,{sourceRef:'https://github.com/haji84/AI-/issues/1205',bindings:[],newRequirement:{title:'郵便一覧2',phase:'P7',baseInventorySha256:createHash('sha256').update(JSON.stringify(p.bundle.inventory)).digest('hex')}},root,intake.list()),/duplicate/);
 }finally{db.close();}
});
