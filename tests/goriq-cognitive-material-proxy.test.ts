import test from "node:test";
import assert from "node:assert/strict";
import { createCognitiveGoalProxy, createCognitiveMaterialProxy,createCognitiveLearningProxy } from "../src/orchestrator/cognitive-material-proxy.ts";
const request=(body:unknown)=>new Request("http://localhost",{method:"POST",body:JSON.stringify(body)});
const input={goalId:"goal-0123456789abcdef",goalDigest:"a".repeat(64),materials:[{format:"text",content:"42",criteria:["criterion-1"]}],mappingAcknowledged:true};
test("owner material proxy rejects authority, oversized input and unauthenticated calls before Broker",async()=>{
 let calls=0;const broker=async()=>{calls++;return Response.json({accepted:true});};
 const denied=createCognitiveMaterialProxy(async()=>false,broker);
 assert.equal((await denied.POST(request(input))).status,401);assert.equal((await denied.GET(new Request("http://localhost"))).status,401);
 const proxy=createCognitiveMaterialProxy(async()=>true,broker);
 for(const bad of [{...input,root:"/"},{...input,materials:[{...input.materials[0],url:"https://example.com"}]},{...input,materials:[{...input.materials[0],content:"x".repeat(65537)}]},{...input,materials:[{...input.materials[0],content:"api_key=super-secret-value"}]}])assert.equal((await proxy.POST(request(bad))).status,400);
 let cancelled=false;const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(300001));},cancel(){cancelled=true;}});
 assert.equal((await proxy.POST(new Request("http://localhost",{method:"POST",body,duplex:"half"}as RequestInit))).status,400);assert.equal(cancelled,true);assert.equal(calls,0);
 assert.equal((await proxy.POST(request(input))).status,200);assert.equal(calls,1);
});
test("artifact proxy relays only bounded verified download bytes with generated filename",async()=>{
 let calls=0;const proxy=createCognitiveMaterialProxy(async()=>true,async(path,init)=>{calls++;assert.ok(init?.signal);assert.match(path,/outputId=output-1/);return Response.json({filename:"output-1.txt",contentBase64:Buffer.from("42").toString("base64"),contentType:"text/html"});});
 const url="http://localhost?goalId="+input.goalId+"&outputId=output-1";
 for(const query of ["&path=/","&goalId="+input.goalId])assert.equal((await proxy.GET(new Request(url+query))).status,400);
 assert.equal(calls,0);const r=await proxy.GET(new Request(url));assert.equal(r.status,200);assert.equal(await r.text(),"42");assert.match(r.headers.get("Content-Type")!,/^text\/plain/);assert.equal(r.headers.get("X-Content-Type-Options"),"nosniff");assert.match(r.headers.get("Content-Disposition")!,/^attachment/);
 const forged=createCognitiveMaterialProxy(async()=>true,async()=>Response.json({filename:"../bad.html",contentBase64:"NDI="}));assert.equal((await forged.GET(new Request(url))).status,503);
});
test("learning proxy restricts actions and never accepts caller verification or history paths",async()=>{
 let calls=0;const broker=async()=>{calls++;return Response.json({accepted:true});};
 assert.equal((await createCognitiveLearningProxy(async()=>false,broker)(request({operation:"import-history"}))).status,401);
 const action=createCognitiveLearningProxy(async()=>true,broker);
 for(const bad of [{operation:"import-history",path:"/"},{operation:"training-candidate",verified:true},{operation:"promote"},{operation:"correct",goalId:input.goalId,originalId:"a",replacementId:"b",verified:true}])assert.equal((await action(request(bad))).status,400);
 assert.equal(calls,0);for(const operation of ["import-history","training-candidate"])assert.equal((await action(request({operation}))).status,200);
});

test("Goal refinement proxy requires owner and exact bounded criteria without scope authority",async()=>{
 let calls=0;const broker=async(path:string,init?:RequestInit)=>{calls++;assert.equal(path,"/api/jarvis/admin/cognitive/goal");assert.ok(init?.signal);return Response.json({adopted:true});};
 const valid={goalId:input.goalId,goalDigest:input.goalDigest,successCriteria:["Exact output"],acknowledgement:true};
 assert.equal((await createCognitiveGoalProxy(async()=>false,broker)(request(valid))).status,401);
 const action=createCognitiveGoalProxy(async()=>true,broker);
 for(const bad of [{...valid,title:"replace"},{...valid,verified:true},{...valid,acknowledgement:false},{...valid,successCriteria:["x".repeat(501)]}])assert.equal((await action(request(bad))).status,400);
 assert.equal(calls,0);assert.equal((await action(request(valid))).status,200);assert.equal(calls,1);
});
