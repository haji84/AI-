import assert from "node:assert/strict";
import test from "node:test";
import {
  AutomaticEscalationEngine,
  CrossDeviceHandoff,
  DemonstrationLearningEngine,
  FactVerificationEngine,
  HomeCoordinatorController,
  InputRecoveryEngine,
  JarvisCompletionRuntime,
  JarvisKnowledgeGraph,
  JarvisSimulator,
  LiveViewScheduler,
  ModelRouterV2,
  MultimodalInteractionEngine,
  OrganizationDigitalTwin,
  ReleaseOperations,
  SecurityKernel,
  SelfGeneratedBenchmarkEngine,
  ValueTracker,
} from "../src/jarvis/index.ts";

test("Home Coordinator supports shadow, single-writer, canary, promote, rollback and LAN/WAN routing", () => {
  const c=new HomeCoordinatorController<{tasks:number}>();
  c.seed({tasks:1},1,new Date("2026-01-01T00:00:00Z"));
  assert.equal(c.routeFor("d1",{sameTrustedLan:true,tailnetAvailable:true,online:true}),"LAN");
  assert.equal(c.routeFor("d1",{sameTrustedLan:false,tailnetAvailable:true,online:true}),"TAILNET");
  assert.equal(c.routeFor("d1",{sameTrustedLan:false,tailnetAvailable:false,online:false}),"OFFLINE");
  c.beginShadow({tasks:1},1);
  c.enableCanary(["android-1"]);
  assert.equal(c.routeAllowedForCanary("android-1"),true);
  assert.equal(c.routeAllowedForCanary("android-2"),false);
  const lease=c.acquireWriter("home-a",5000,1000);
  assert.equal(c.validateWriter(lease.token,2000),true);
  assert.throws(()=>c.acquireWriter("home-b",5000,2000));
  c.promoteShadow();
  assert.equal(c.currentMode(),"PRIMARY");
  c.rollback();
  assert.equal(c.currentMode(),"ROLLBACK");
});

test("Fact Verification covers authority, independence, freshness, contradiction, entailment and numeric validation", async () => {
  const engine=new FactVerificationEngine(async()=>42);
  const claim={id:"c1",text:"product output is 42 units",type:"numeric" as const,numericExpression:{expected:42}};
  const sources=[
    {id:"s1",originId:"origin-a",publisher:"official",sourceType:"official" as const,publishedAt:"2026-01-01",retrievedAt:"2026-01-02",passage:"Product output is 42 units.",supports:["c1"]},
    {id:"s2",originId:"origin-b",publisher:"test",sourceType:"independent-test" as const,publishedAt:"2026-01-01",retrievedAt:"2026-01-02",passage:"Independent product output is 42 units.",supports:["c1"]},
  ];
  const audit=await engine.audit(claim,sources,Date.parse("2026-02-01"));
  assert.equal(audit.numericCheck?.ok,true);
  assert.ok(["VERIFIED","SUPPORTED"].includes(audit.status));
  assert.equal(engine.evidenceGraph([audit])[0].edges.length,2);
  const conflict=await engine.audit(claim,[...sources,{...sources[1],id:"s3",originId:"origin-c",supports:[],contradicts:["c1"]}],Date.parse("2026-02-01"));
  assert.equal(conflict.status,"CONFLICTED");
});

test("Organization Digital Twin switches rules by effective date and exposes impact", () => {
  const twin=new OrganizationDigitalTwin();
  twin.upsertRule({id:"r1",title:"old",authority:"regulation",version:"1",effectiveFrom:"2025-01-01",effectiveTo:"2025-12-31",source:"law",scope:["expense"],content:{}});
  twin.upsertRule({id:"r2",title:"new",authority:"regulation",version:"2",effectiveFrom:"2026-01-01",source:"law",scope:["expense"],content:{}});
  twin.upsertRule({id:"practice",title:"custom",authority:"practice",version:"1",effectiveFrom:"2020-01-01",source:"local",scope:["expense"],content:{}});
  twin.upsertWorkflow({id:"wf",name:"approval",version:"1",effectiveFrom:"2026-01-01",steps:[{role:"chief",action:"approve",order:2},{role:"staff",action:"draft",order:1}]});
  assert.equal(twin.selectRule("expense","2026-03-01")?.id,"r2");
  assert.deepEqual(twin.approvalPath("wf","2026-03-01").map(x=>x.role),["staff","chief"]);
  assert.ok(twin.impactOfRule("r2").scopes.includes("expense"));
});

test("Demonstration Learning removes corrected mistakes and promotes only verified skills", () => {
  const e=new DemonstrationLearningEngine();
  const events=[
    {at:"1",kind:"keyboard" as const,target:"amount",after:"100"},
    {at:"2",kind:"error" as const,target:"amount",message:"invalid"},
    {at:"3",kind:"delete" as const,target:"amount"},
    {at:"4",kind:"reentry" as const,target:"amount",after:"1000"},
    {at:"5",kind:"save" as const,target:"form"},
  ];
  assert.equal(e.classifyCorrection(events),"input-error");
  const wf=e.inferWorkflow("monthly report",events);
  assert.ok(wf.validationRules.includes("prevent-repeat:input-error"));
  assert.equal(e.promoteSkill(wf,3,0).promoted,true);
  assert.equal(e.promoteSkill(wf,2,0).promoted,false);
});

test("Input Recovery isolates current/reference/other cases and preserves conflicts", () => {
  const e=new InputRecoveryEngine();
  const docs=[
    {id:"a",name:"current-v1",caseId:"X",version:"1",content:{amount:100,name:"A"}},
    {id:"b",name:"current-v2",caseId:"X",version:"2",content:{amount:200,name:"A"}},
    {id:"c",name:"参考.pdf",caseId:"R",content:{amount:999}},
  ];
  assert.equal(e.classify(docs[2],"X"),"reference");
  assert.equal(e.newest(docs.slice(0,2)).id,"b");
  const recovered=e.recover(docs,"X");
  assert.equal(recovered.find(x=>x.field==="name")?.state,"CONFIRMED");
  assert.equal(recovered.find(x=>x.field==="amount")?.state,"CONFLICTED");
  assert.equal(e.reconstruct(["missing"],recovered)[0].state,"UNKNOWN");
});

test("Model Router enforces data, hardware, modality, local/cloud and cost-per-success", () => {
  const r=new ModelRouterV2();
  const models=[
    {id:"local",local:true,modalities:["text" as const],quality:0.8,latencyMs:1000,cost:0,ramGb:8,vramGb:4,allowedData:["confidential" as const],successRate:0.9,available:true},
    {id:"cloud",local:false,modalities:["text" as const],quality:0.95,latencyMs:500,cost:1,ramGb:0,vramGb:0,allowedData:["public" as const],successRate:0.98,available:true},
  ];
  assert.equal(r.route({modality:"text",dataClass:"confidential",minQuality:0.7,localOnly:true,cloudBudget:0,availableRamGb:16,availableVramGb:8},models).selected?.id,"local");
  assert.equal(r.route({modality:"text",dataClass:"secret",minQuality:0.7,localOnly:true,cloudBudget:0,availableRamGb:16,availableVramGb:8},models).selected,null);
});

test("Security Kernel is default-deny, tenant-isolated, ephemeral and Human-Gated for high risk", () => {
  const k=new SecurityKernel();
  const now=Date.now();
  k.issueGrant({id:"g1",tenantId:"t1",actorId:"a1",workerId:"w1",actions:["read"],resources:["repo"],destinations:["github"],expiresAt:now+10_000});
  assert.equal(k.evaluate({tenantId:"t1",actorId:"a1",workerId:"w1",action:"read",resource:"repo/file",destination:"github",risk:"LOW",capabilities:[]},now+1000).allow,true);
  assert.equal(k.evaluate({tenantId:"t1",actorId:"a1",workerId:"w2",action:"read",resource:"repo/file",destination:"github",risk:"LOW",capabilities:[]},now+1000).allow,false);
  assert.equal(k.evaluate({tenantId:"t1",actorId:"a1",workerId:"w1",action:"write",resource:"repo",risk:"HIGH",capabilities:[]},now+1000).humanGate,true);
  k.revokeGrant("g1",now+2000);
  assert.equal(k.evaluate({tenantId:"t1",actorId:"a1",workerId:"w1",action:"read",resource:"repo",risk:"LOW",capabilities:[]},now+3000).allow,false);
  assert.throws(()=>k.enforceTenant("t1","t2"));
});

test("Knowledge Graph tracks dependencies and change impact", () => {
  const g=new JarvisKnowledgeGraph();
  for(const node of [
    {id:"rule",type:"Rule" as const,label:"Rule"},
    {id:"taskA",type:"Task" as const,label:"A"},
    {id:"taskB",type:"Task" as const,label:"B"},
  ]) g.upsertNode(node);
  g.link({from:"taskA",to:"taskB",type:"DEPENDS_ON"});
  g.link({from:"rule",to:"taskA",type:"AFFECTS"});
  assert.deepEqual(g.dependencyOrder(["taskA","taskB"]),["taskA","taskB"]);
  assert.equal(g.impact("rule").length,3);
});

test("Simulation provides side-effect-free risk and rollback plan", () => {
  const s=new JarvisSimulator();
  const result=s.simulate([{id:"c1",kind:"config",target:"x",before:1,after:2,reversible:true}]);
  assert.equal(result.safe,true);
  assert.deepEqual(result.rollback,["restore:x"]);
  assert.equal(s.simulate([{id:"c2",kind:"data",target:"db",before:1,after:0,reversible:false}]).safe,false);
});

test("Cross-device handoff resumes only on trusted capable devices", () => {
  const h=new CrossDeviceHandoff();
  const cp={jobId:"j",goal:"g",step:"s",state:{x:1},requiredCapabilities:["browser"],createdAt:"2026-01-01",sourceDeviceId:"phone",version:1};
  const device=h.choose(cp,[{id:"pc",online:true,trusted:true,capabilities:["browser"],load:0.2}]);
  assert.equal(device?.id,"pc");
  assert.equal(h.resume(cp,device!).version,2);
});

test("Value tracking measures time, cost, errors, automation and intervention", () => {
  const v=new ValueTracker().summarize([{jobId:"j1",at:"x",humanMinutesBefore:60,humanMinutesAfter:10,costBefore:100,costAfter:20,errorsBefore:4,errorsAfter:1,interventions:1,automatedSteps:9,totalSteps:10,qualityBefore:0.5,qualityAfter:0.9}]);
  assert.equal(v.timeSavedMinutes,50); assert.equal(v.costSaved,80); assert.equal(v.errorsReduced,3); assert.equal(v.automationRate,0.9);
});

test("Self-generated benchmarks derive regression cases from repeated runtime evidence", () => {
  const e=new SelfGeneratedBenchmarkEngine();
  const outcomes=Array.from({length:3},()=>({taskType:"doc",inputShape:"pdf",success:true,durationMs:10,cost:0,humanInterventions:0}));
  assert.equal(e.generate(outcomes).length,1);
  assert.equal(e.score([{id:"a",passed:true,durationMs:10,cost:0}]).passRate,1);
});

test("Automatic escalation exhausts alternatives before Human except for high risk", () => {
  const e=new AutomaticEscalationEngine();
  const base={attempted:[] as Array<"MODEL"|"AGENT"|"TOOL"|"RESEARCH"|"SPECIALIST"|"HUMAN">,risk:"LOW" as const,confidence:0.2,recoverable:true,available:{models:1,agents:1,tools:1,research:true,specialists:true}};
  assert.equal(e.next(base),"MODEL");
  assert.equal(e.next({...base,risk:"HIGH"}),"HUMAN");
});

test("Release operations cover wizard, diagnostics, SLO/RTO/RPO, backup and rollback", () => {
  const r=new ReleaseOperations();
  assert.equal(r.readiness([{name:"broker",ok:true}],{slo:0.99,rtoMinutes:10,rpoMinutes:5}).ready,true);
  assert.equal(r.firstRunState({ownerAuth:true,coordinator:true,privateIngress:true,backup:true,diagnostics:true}).complete,true);
  assert.equal(r.validateBackup({createdAt:"x",commit:"a",stateVersion:"1",artifacts:[{name:"db",checksum:"x",required:true}]},new Set(["db"])).restorable,true);
  assert.equal(r.rollbackPlan("b","a").steps.includes("health-check"),true);
});

test("Live View scheduler handles multidevice load, layouts and backpressure", () => {
  const s=new LiveViewScheduler();
  const slots=s.schedule(Array.from({length:12},(_,i)=>({id:`d${i}`,online:true,capability:"controllable" as const,preferredFps:5,latencyMs:i*100,errorRate:0})),9);
  assert.equal(slots.length,9); assert.equal(s.layout(4),"grid4"); assert.ok(s.loadEstimate(slots).framesPerSecond>0); assert.equal(s.backoff(20),30000);
});

test("Multimodal interaction resolves context, free voice goals, safe gestures, distance and accessibility", () => {
  const e=new MultimodalInteractionEngine();
  const items=[{id:"1",label:"A",kind:"task",createdAt:"2026-01-01"},{id:"2",label:"B",kind:"task",createdAt:"2026-01-02"}];
  assert.equal(e.resolveReference("これ",items)?.id,"2");
  assert.equal(e.resolveReference("2番",items)?.id,"1");
  assert.equal(e.voiceToGoal("資料まとめて").accepted,true);
  assert.equal(e.gestureDecision({name:"delete",confidence:0.95,stableMs:700}).requiresConfirm,true);
  assert.equal(e.distanceProfile(4).scale,1.5);
  assert.equal(e.accessibilityAudit({keyboard:true,captions:true,contrastRatio:7,targetPx:64,labels:true}).pass,true);
});

test("Completion runtime exposes every non-physical engine as one integrated surface", () => {
  const runtime=new JarvisCompletionRuntime();
  assert.equal(Object.values(runtime.softwareReadiness()).every(Boolean),true);
});
