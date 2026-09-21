import assert from "node:assert/strict";import test from "node:test";
import{verifyFacts,type FactClaim}from "../src/orchestrator/fact-verifier.ts";
import{SpreadsheetSandboxCapability,verifySpreadsheet,type SpreadsheetWorkbook}from "../src/orchestrator/spreadsheet-sandbox-capability.ts";
import{DocumentSandboxCapability,verifyDocument,type SandboxDocument}from "../src/orchestrator/document-sandbox-capability.ts";
import type{WorkAction,WorkVerifierContract}from "../src/orchestrator/work-capability.ts";
function action(domain:"spreadsheet"|"document",capability:string,operation:string,input:Record<string,unknown>,verifier:WorkVerifierContract,strategyId:string):WorkAction{return{goalId:"mixed-goal",jobId:`job-${domain}`,attemptId:`attempt-${strategyId}`,strategyId,capability,domain,operation,input,scope:[{kind:domain,ids:["fixture"]}],expectedOutputs:["verified"],risk:"low",access:"write",externalSideEffect:false,irreversible:false,verifier}}
test("mixed work goal: research facts -> spreadsheet -> document -> recovery -> complete",async()=>{
 let claims:FactClaim[]=[{id:"population",value:1520,required:true,status:"UNVERIFIED",sources:[{id:"old",sourceClass:"reliable_secondary",retrievedAt:"2025-01-01",value:1250},{id:"official",sourceClass:"official",retrievedAt:"2026-09-22",value:1520}]}];
 let facts=verifyFacts(claims);assert.equal(facts.ok,false);
 claims=[{id:"population",value:1520,required:true,status:"UNVERIFIED",sources:[{id:"official",sourceClass:"official",retrievedAt:"2026-09-22",value:1520}]}];facts=verifyFacts(claims);assert.equal(facts.ok,true);
 const sv:WorkVerifierContract={kind:"spreadsheet.cells_exact",required:true,spec:{cells:[{sheet:"Summary",cell:"B2",value:1520}]}};const wb:SpreadsheetWorkbook={cells:[]};const sc=new SpreadsheetSandboxCapability(wb);
 await sc.execute(action("spreadsheet","spreadsheet.write","set_cells",{cells:[{sheet:"Summary",cell:"B2",value:1250}]},sv,"wrong"));assert.equal(verifySpreadsheet(wb,sv).ok,false);
 await sc.execute(action("spreadsheet","spreadsheet.write","set_cells",{cells:[{sheet:"Summary",cell:"B2",value:1520}]},sv,"recovery"));assert.equal(verifySpreadsheet(wb,sv).ok,true);
 const dv:WorkVerifierContract={kind:"document.required_sections",required:true,spec:{sections:["概要","根拠","結論"]}};const doc:SandboxDocument={title:"報告",sections:{}};const dc=new DocumentSandboxCapability(doc);
 await dc.execute(action("document","document.write","write_sections",{sections:{"概要":"人口 1520","結論":"確認完了"}},dv,"initial"));assert.equal(verifyDocument(doc,dv).ok,false);
 await dc.execute(action("document","document.write","write_sections",{sections:{"根拠":"official source: population=1520"}},dv,"recovery"));assert.equal(verifyDocument(doc,dv).ok,true);
 assert.equal(facts.ok&&verifySpreadsheet(wb,sv).ok&&verifyDocument(doc,dv).ok,true);
});
