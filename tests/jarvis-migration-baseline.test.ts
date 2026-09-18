import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { migrationBaseline, compareMigrationBaseline } from "../src/jarvis/migration-baseline.ts";
import type { JarvisControlPlaneSnapshot } from "../src/jarvis/control-plane.ts";
const now = new Date("2026-09-17T00:00:00Z");
const key = generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"pem"}).toString();
const identity = { nodeId: "existing", publicKeyPem: key, enrolledAt: now.toISOString() };
function fixture() { return { generatedAt: now.toISOString(), fleet: [{ id: "existing", kind: "android", label:"Phone", capabilities:["remote-view"],
  policy:{allowRemoteControl:true}, telemetry:{remoteProtocol:1,workerVersion:"0.4.3"}, lastSeenAt:now.toISOString(),status:"ready",enrollment:"quick" }],
  tasks:[{id:"pending",status:"queued",targetNodeId:"existing",payload:{secret:"NEVER_EXPORT"}}],audit:[],activeTakeovers:[],stats:{} } as unknown as JarvisControlPlaneSnapshot; }
test("metadata baseline preserves identities and pending tasks without exporting content",()=>{
  const s=fixture(); const b=migrationBaseline(s,[identity],now);
  assert.equal(b.devices[0].credentialExists,true); assert.equal(b.tasks[0].id,"pending");
  assert.deepEqual(b.devices[0].pendingTasks,["pending"]);
  assert.equal(b.devices[0].connectivity,"recent-heartbeat");
  const encoded=JSON.stringify(b); assert.ok(!encoded.includes("NEVER_EXPORT")); assert.ok(!encoded.includes("BEGIN PUBLIC KEY"));
  assert.deepEqual(compareMigrationBaseline(b,migrationBaseline(structuredClone(s),[identity],now)),[]);
});
test("device/key/policy/queue/history loss must fail comparison",()=>{
  const base=migrationBaseline(fixture(),[identity],now);
  for(const change of [(s:JarvisControlPlaneSnapshot)=>{s.fleet=[];},(s:JarvisControlPlaneSnapshot)=>{s.tasks=[];},
    (s:JarvisControlPlaneSnapshot)=>{s.fleet[0].policy.allowRemoteControl=false;},
    (s:JarvisControlPlaneSnapshot)=>{s.tasks[0].payload={};}]){
    const s=fixture(); change(s); assert.ok(compareMigrationBaseline(base,migrationBaseline(s,[identity],now)).length);
  }
  assert.ok(compareMigrationBaseline(base,migrationBaseline(fixture(),[],now)).length);
  const other=generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"pem"}).toString();
  assert.ok(compareMigrationBaseline(base,migrationBaseline(fixture(),[{...identity,publicKeyPem:other}],now)).length);
});
test("duplicate identities fail closed and input is never modified",()=>{
  const s=fixture(), original=JSON.stringify(s); migrationBaseline(s,[identity],now); assert.equal(JSON.stringify(s),original);
  assert.throws(()=>migrationBaseline(s,[identity,identity],now),/Duplicate/);
  s.fleet.push(s.fleet[0]); assert.throws(()=>migrationBaseline(s,[identity],now),/Duplicate/);
});
