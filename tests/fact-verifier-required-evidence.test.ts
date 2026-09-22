import assert from "node:assert/strict";
import test from "node:test";
import { verifyFacts, type FactClaim } from "../src/orchestrator/fact-verifier.ts";
test("required inferred claim without evidence blocks goal completion",()=>{
 const result=verifyFacts([{id:"required",value:42,required:true,status:"INFERRED",sources:[]}]);
 assert.equal(result.ok,false); assert.deepEqual(result.blocked,["required"]);
 assert.equal(result.claims[0].status,"INFERRED");
});
test("optional inferred claim stays visible without blocking confirmed required claims",()=>{
 const claims:FactClaim[]=[
 {id:"required",value:42,required:true,status:"UNVERIFIED",sources:[{id:"source",sourceClass:"official",retrievedAt:"2026-09-22",value:42}]},
 {id:"optional",value:43,required:false,status:"INFERRED",sources:[]}];
 const result=verifyFacts(claims);assert.equal(result.ok,true);assert.equal(result.claims[1].status,"INFERRED");
});
