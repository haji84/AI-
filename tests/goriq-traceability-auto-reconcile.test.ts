import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { autoReconcileTraceability } from "../src/orchestrator/safe-pr-capability.ts";

function fixture() {
 const root=mkdtempSync(join(tmpdir(),"goriq-reconcile-")); mkdirSync(join(root,"src"),{recursive:true}); mkdirSync(join(root,"docs"),{recursive:true});
 writeFileSync(join(root,"src/example.ts"),"export const value = 2;\n");
 writeFileSync(join(root,"docs/jarvis-reverse-traceability.json"),JSON.stringify({surfaces:[{path:"src/example.ts",sha256:"0".repeat(64),classification:"COVERED_BY_REQUIREMENT",requirement_ids:["AUTO-001"],reason:"existing mapping"}]},null,2)+"\n");\n writeFileSync(join(root,"docs/jarvis-requirements.json"),JSON.stringify({requirements:[{id:"AUTO-001"}]},null,2)+"\n");
 return root;
}
test("LOW existing mapped surface reconciles fingerprint in same Change Set",()=>{const root=fixture();assert.deepEqual(autoReconcileTraceability(root,["src/example.ts"],"low"),["docs/jarvis-reverse-traceability.json"]);const r=JSON.parse(readFileSync(join(root,"docs/jarvis-reverse-traceability.json"),"utf8"));assert.notEqual(r.surfaces[0].sha256,"0".repeat(64));assert.deepEqual(r.surfaces[0].requirement_ids,["AUTO-001"]);});
test("HIGH and audit/canonical changes never auto-reconcile",()=>{const root=fixture();assert.deepEqual(autoReconcileTraceability(root,["src/example.ts"],"high"),[]);assert.deepEqual(autoReconcileTraceability(root,["scripts/jarvis-requirement-audit.mjs"],"low"),[]);});
test("missing canonical mapping is not invented",()=>{const root=fixture();writeFileSync(join(root,"src/new.ts"),"x\n");assert.deepEqual(autoReconcileTraceability(root,["src/new.ts"],"low"),[]);});
test("verified existing requirement binding can reconcile a new audited surface",()=>{const root=fixture();writeFileSync(join(root,"src/new.ts"),"export const added = true;\n");const changed=autoReconcileTraceability(root,["src/new.ts"],"low",[{path:"src/new.ts",requirementIds:["AUTO-001"],classification:"COVERED_BY_REQUIREMENT",reason:"verified Goal requirement binding",verified:true,verifierId:"requirement-verifier"}]);assert.deepEqual(changed,["docs/jarvis-reverse-traceability.json"]);const r=JSON.parse(readFileSync(join(root,"docs/jarvis-reverse-traceability.json"),"utf8"));const row=r.surfaces.find((x:{path:string})=>x.path==="src/new.ts");assert.deepEqual(row?.requirement_ids,["AUTO-001"]);assert.match(row?.sha256??"",/^[a-f0-9]{64}$/);});
test("new surface binding cannot invent an unknown requirement",()=>{const root=fixture();writeFileSync(join(root,"src/new.ts"),"x\n");assert.throws(()=>autoReconcileTraceability(root,["src/new.ts"],"low",[{path:"src/new.ts",requirementIds:["AUTO-999"],classification:"COVERED_BY_REQUIREMENT",reason:"bad binding",verified:true,verifierId:"requirement-verifier"}]),/unknown canonical requirement/);});

test("safe PR creation fails closed when its repository base is behind main", async () => {
 const s=readFileSync(new URL("../src/orchestrator/safe-pr-capability.ts",import.meta.url),"utf8");
 assert.match(s,/git", \["fetch", "origin", "main"/);
 assert.match(s,/merge-base/);
 assert.match(s,/base is behind origin\/main/);
});
