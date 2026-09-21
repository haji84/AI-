import assert from "node:assert/strict";import test from "node:test";import {verifyFacts,type FactClaim} from "../src/orchestrator/fact-verifier.ts";
test("fact verifier blocks conflict, unsupported hallucination and stale current claim",()=>{const claims:FactClaim[]=[
{id:"amount",value:1520,required:true,status:"UNVERIFIED",sources:[{id:"old",sourceClass:"reliable_secondary",retrievedAt:"2026-01-01",value:1250},{id:"official",sourceClass:"official",retrievedAt:"2026-09-01",value:1520}]},
{id:"name",value:"架空太郎",required:true,status:"CONFIRMED",sources:[]},
{id:"current",value:"new",required:true,freshnessSensitive:true,status:"UNVERIFIED",sources:[{id:"stale",sourceClass:"official",retrievedAt:"2025-01-01",value:"new"}]}];
const first=verifyFacts(claims,{latestSourceByClaim:{current:"fresh"}});assert.equal(first.ok,false);assert.deepEqual(first.blocked.sort(),["amount","current","name"]);
const repaired:FactClaim[]=[
{id:"amount",value:1520,required:true,status:"UNVERIFIED",sources:[{id:"official",sourceClass:"official",retrievedAt:"2026-09-01",value:1520}]},
{id:"current",value:"new",required:true,freshnessSensitive:true,status:"UNVERIFIED",sources:[{id:"fresh",sourceClass:"official",retrievedAt:"2026-09-22",value:"new"}]}];
const second=verifyFacts(repaired,{latestSourceByClaim:{current:"fresh"}});assert.equal(second.ok,true);assert.ok(second.claims.every(c=>c.status==="CONFIRMED"));});
