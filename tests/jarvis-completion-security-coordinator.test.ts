import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AuthenticatedAgentFabric,
  CoordinatorCompatibilityBridge,
  CoordinatorReplicaStore,
  DataLifecycleEngine,
  DefaultDenyEgressPolicy,
  PolicyAsCodeEngine,
  RevocationRegistry,
} from "../src/jarvis/index.ts";

test("Coordinator compatibility bridge keeps legacy default, shadows only reads and canaries explicitly", () => {
  const bridge=new CoordinatorCompatibilityBridge({name:"legacy",baseUrl:"http://127.0.0.1:8787"},{name:"candidate",baseUrl:"https://coordinator.tailnet.example"});
  assert.equal(bridge.targetFor({method:"POST",path:"/x",deviceId:"d1"}).name,"legacy");
  bridge.setMode("SHADOW");
  assert.equal(bridge.shadowTargetFor({method:"GET",path:"/state"})?.name,"candidate");
  assert.equal(bridge.shadowTargetFor({method:"POST",path:"/task"}),null);
  bridge.setCanaries(["d1"]);
  assert.equal(bridge.targetFor({method:"GET",path:"/state",deviceId:"d1"}).name,"candidate");
  assert.equal(bridge.targetFor({method:"GET",path:"/state",deviceId:"d2"}).name,"legacy");
  const body=new TextEncoder().encode("same");
  assert.equal(bridge.compare("/state",{status:200,body},{status:200,body}).equal,true);
});

test("Coordinator replica store persists shadow comparison, single-writer, promotion and rollback", () => {
  const root=mkdtempSync(join(tmpdir(),"jarvis-coordinator-"));
  try{
    const store=new CoordinatorReplicaStore<{jobs:number}>(join(root,"state.json"));
    const primary=store.snapshot("JARVIS-HOME-COORDINATOR",{jobs:1},1,new Date("2026-01-01"));
    store.setPrimary(primary);store.setShadow({...primary});
    assert.equal(store.compare().equal,true);
    const lease=store.acquireWriter("home-a",5000,Date.now());
    assert.equal(store.validateWriter(lease.token,Date.now()),true);
    store.promote();
    assert.equal(store.rollback().logicalId,"JARVIS-HOME-COORDINATOR");
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("Policy-as-Code is deterministic and default deny", () => {
  const p=new PolicyAsCodeEngine();
  p.load([{id:"read-repo",effect:"allow",actions:["read"],resources:["repo"],tenants:["t1"],priority:10}]);
  assert.equal(p.evaluate({tenantId:"t1",action:"read",resource:"repo/file",risk:"LOW"}).effect,"allow");
  assert.equal(p.evaluate({tenantId:"t2",action:"read",resource:"repo/file",risk:"LOW"}).effect,"deny");
});

test("Agent communication authenticates identities and blocks replay", () => {
  const f=new AuthenticatedAgentFabric();f.registerIdentity("a","1234567890123456");f.registerIdentity("b","abcdefghijklmnop");
  const unsigned={from:"a",to:"b",tenantId:"t",jobId:"j",type:"result",payload:{ok:true},timestamp:1000,nonce:"n1"};
  const msg=f.sign(unsigned);
  assert.equal(f.verify(msg,1000).ok,true);
  assert.equal(f.verify(msg,1000).reason,"replay");
  f.revokeIdentity("a");
  assert.equal(f.verify({...msg,nonce:"n2"},1000).reason,"identity");
});

test("Default-deny egress requires scoped job/worker/destination/protocol grant", () => {
  const e=new DefaultDenyEgressPolicy();const now=Date.now();
  e.grant({id:"e1",jobId:"j",workerId:"w",destination:"api.example.com",protocol:"https",expiresAt:now+10000});
  assert.equal(e.check({jobId:"j",workerId:"w",destination:"api.example.com",protocol:"https"},now).allow,true);
  assert.equal(e.check({jobId:"j",workerId:"other",destination:"api.example.com",protocol:"https"},now).allow,false);
  e.revoke("e1");assert.equal(e.check({jobId:"j",workerId:"w",destination:"api.example.com",protocol:"https"},now).allow,false);
});

test("Revocation propagates by generation", () => {
  const r=new RevocationRegistry();const event=r.revoke("device","d1","lost",1);
  assert.equal(r.isRevoked("device","d1"),true);
  assert.deepEqual(r.since(0),[event]);
});

test("Data lifecycle enforces purpose, retention and deletion verification plan", () => {
  const e=new DataLifecycleEngine();
  const record={id:"p",classification:"personal" as const,purpose:"case",createdAt:"2026-01-01",locations:["db","backup"]};
  assert.equal(e.decide(record,new Set(["case"]),Date.parse("2026-01-02")).action,"retain");
  assert.equal(e.decide(record,new Set(["other"]),Date.parse("2026-01-02")).action,"quarantine");
  assert.equal(e.deletionPlan(record).steps.length,2);
});
