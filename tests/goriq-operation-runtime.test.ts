import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CompassStore } from "../src/compass/store.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";
import { CognitiveStateStore, type CognitiveState } from "../src/gai/cognitive-state.ts";
import { CognitiveLocalOutcomeCatalog } from "../src/gai/cognitive-local-outcomes.ts";
import { CognitiveCore, type CognitiveCandidate, type CognitiveLearningBridge } from "../src/gai/cognitive-core.ts";
const partition = { tenantId: "local", principalId: "owner" };

test("two real material Goals retain exact identity and produce inert portable operation candidates", async () => {
 const root = await mkdtemp(join(tmpdir(), "goriq-operation-runtime-"));
 try {
  const dataRoot = join(root,"data"), db = join(root,"compass.db"), stateRoot = join(root,"cognitive"); await mkdir(dataRoot);
  const options = { stateRoot, materialIntake: { dataRoot }, partition };
  const learner = new CognitiveLearningEngine(join(stateRoot,"learning"));
  const states: CognitiveState[] = [];
  for (const number of [1,2]) {
   const store = new CompassStore(db); store.setGoal({ title:"Preserve supplied text", description:`Independent request ${number}`, successCriteria:["Output preserves source text"] }); store.close();
   const service = new CognitiveService(db, options), status = await service.status();
   const content = `Independent source ${number}`;
   const receipt = await service.prepareMaterials({ goalId:status.goalId, goalDigest:status.goalDigest, materials:[{format:"text",content,criteria:["criterion-1"]}],mappingAcknowledged:true });
   assert.equal((await service.continue(status.goalId!)).stopReason,"goal_complete");
   assert.equal((await service.output(status.goalId!,receipt.outputs[0].id)).bytes.toString(),content);
   const saved = await new CognitiveStateStore(stateRoot,partition).get(status.goalId!); assert.ok(saved); states.push(saved);
   assert.equal(saved.external_ai_calls,0);
   if(number===1) assert.equal((await learner.candidates(partition)).length,0);
  }
  assert.notEqual(states[0].goal_id,states[1].goal_id);
  assert.notEqual(states[0].execution_contract_digest,states[1].execution_contract_digest);
  assert.ok(states[0].attempts.every(a=>!states[1].attempts.some(b=>a.actionId===b.actionId)));
  const candidates = await new CognitiveLearningEngine(learner.directory).candidates(partition);
  assert.equal(candidates.length,2);
  assert.ok(candidates.every(c=>c.status==="candidate" && c.sourceExperiences.length===2));
  assert.deepEqual(candidates.map(c=>JSON.parse(c.executionProcedure).catalogOperation).sort(),["material:v1:copy:text","material:v1:inspect:text"]);
  assert.ok(candidates.every(c=>!c.executionProcedure.includes(dataRoot) && !c.executionProcedure.includes(states[0].goal_id)));
  const exported = await learner.exportVerifiedData(partition);
  assert.equal(exported.experiences.length,4);
  assert.ok(exported.experiences.every(e=>e.learningOperation && states.some(s=>s.attempts.some(a=>a.id===e.id && a.actionId===e.actionId && a.learningOperation===e.learningOperation))));
  assert.equal((await learner.recall({ partition,goalId:"next",task:"Preserve supplied text",environment:`${process.platform}:local`})).skills.length,0);
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("host outcome compiler derives all six versioned operation bindings without weakening dependencies", async () => {
 const root = await mkdtemp(join(tmpdir(),"goriq-operation-catalog-"));
 try {
  for (const [format,domain,extension,operation] of [["text","file","txt","copy:text"],["workbook-json","spreadsheet","xlsx","create:xlsx"],["document-json","document","docx","create:docx"]] as const) {
   const catalog = new CognitiveLocalOutcomeCatalog(root,{version:1,goalId:"test",materials:[{id:"source",path:"source.json",sha256:createHash("sha256").update("data").digest("hex"),format}],outcomes:[{id:"result",materialId:"source",path:`result.${extension}`,domain,criteria:["criterion-1"]}]},"test",{title:"Convert source",successCriteria:["Output matches source"],constraints:[]});
   const first = await catalog.candidates(); assert.equal(first.length,1);
   assert.equal(first[0].learningOperation,`material:v1:inspect:${format}`);
   assert.equal((await catalog.candidates([first[0].id]))[1].learningOperation,`material:v1:${operation}`);
  }
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("certified operation resolves only current eligible local actions, never old learned paths or IDs", async () => {
 const root = await mkdtemp(join(tmpdir(),"goriq-operation-select-"));
 try {
  const operation = "material:v1:copy:text" as const, goal={title:"Copy text",successCriteria:["Current output verified"],constraints:[]};
  const action = (id:string, extra:Partial<CognitiveCandidate>={}):CognitiveCandidate => ({id,kind:"experiment",learningOperation:operation,action:{id,capability:"registered.current",description:"Current host scope only",risk:"low",input:{path:id}},expectedOutcome:"Current output",evidenceRequired:["current-verifier"],...extra});
  const learning:CognitiveLearningBridge = {async observe(){},async recall(){return {memories:[],strategies:[],corrections:[],avoidActionIds:[],skills:[{id:"certified",actionId:"old-action",operation,environment:"local",confidence:0.9,evidenceRefs:["independent"],maxRisk:"low"}]};}};
  for(const [index,candidates,wanted] of [
   [0,[action("current")],"current"],
   [1,[action("wrong",{learningOperation:"material:v1:create:docx"}),action("current")],"current"],
   [2,[action("remote",{requiresExternalAI:true})],"cognitive:inspect"],
   [3,[],"cognitive:inspect"],
  ] as const){
   const state = new CognitiveStateStore(join(root,String(index)),partition);
   const core = new CognitiveCore({goalId:`select-${index}`,partition,state,environment:"local",learning,candidates:async()=>[...candidates]});
   const selected = await core.proposeNextAction({goal,context:[],intent:{summary:"Copy",confidence:1,evidence:[]}});
   assert.ok(selected); assert.equal(selected.id,wanted);
   const saved = await state.get(`select-${index}`);
   if(wanted==="current") { assert.deepEqual(selected.input,{path:"current"}); assert.equal(saved?.selected_strategy,"current"); assert.equal(saved?.mode,"DEGRADED"); }
  }
 } finally { await rm(root,{recursive:true,force:true}); }
});
