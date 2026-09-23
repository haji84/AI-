import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { cognitiveHostOptions } from "../src/gai/cognitive-host-config.ts";

test("owner material intake executes and downloads verified text without a step manifest or external AI", async()=>{
 const root=await mkdtemp(join(tmpdir(),"goriq-intake-")), db=join(root,"compass.db"), data=join(root,"data");
 try {
  await mkdir(data);const compass=new CompassStore(db);compass.setGoal({title:"Preserve supplied text",successCriteria:["Supplied text is preserved in the output"]});compass.close();
  const options=cognitiveHostOptions({GORIQ_LOCAL_MATERIAL_INTAKE:"1",GORIQ_LOCAL_DATA_ROOT:data});
  const service=new CognitiveService(db,options);const state=await service.status();
  assert.equal(state.materialIntakeEnabled,true);
  const input={goalId:state.goalId,goalDigest:state.goalDigest,materials:[{format:"text",content:"provided 42",criteria:["criterion-1"]}],mappingAcknowledged:true};
  const receipt=await service.prepareMaterials(input);assert.equal(receipt.outputs.length,1);
  assert.deepEqual(await service.prepareMaterials(input),receipt);
  await assert.rejects(()=>service.output(state.goalId!,receipt.outputs[0].id),/verified/i);
  assert.equal((await service.continue(state.goalId!)).stopReason,"goal_complete");
  const output=await service.output(state.goalId!,receipt.outputs[0].id);assert.equal(output.bytes.toString(),"provided 42");
  assert.equal((await service.status()).metrics.externalAiCallsPerGoal,0);
  const restarted=new CognitiveService(db,options);assert.deepEqual((await restarted.status()).materials,receipt);
  assert.equal((await restarted.output(state.goalId!,receipt.outputs[0].id)).bytes.toString(),"provided 42");
  assert.equal((await service.status()).attempts,2);
  assert.ok((await readFile(db)).length>0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("material intake rejects stale Goal, scope injection, missing acknowledgement and conflicting retries",async()=>{
 const root=await mkdtemp(join(tmpdir(),"goriq-intake-policy-")),db=join(root,"compass.db"),data=join(root,"data");
 try{
  await mkdir(data);const compass=new CompassStore(db);compass.setGoal({title:"Copy",successCriteria:["Copy supplied text"]});compass.close();
  const service=new CognitiveService(db,{materialIntake:{dataRoot:data}});const state=await service.status();
  const input={goalId:state.goalId,goalDigest:state.goalDigest,materials:[{format:"text",content:"42",criteria:["criterion-1"]}],mappingAcknowledged:true};
  for(const bad of [{...input,path:"/etc/passwd"},{...input,goalDigest:"0".repeat(64)},{...input,mappingAcknowledged:false},{...input,materials:[{...input.materials[0],criteria:["criterion-999"]}]},{...input,materials:[{...input.materials[0],content:"x".repeat(65537)}]},{...input,materials:[{...input.materials[0],sha256:"0".repeat(64)}]}])await assert.rejects(()=>service.prepareMaterials(bad));
  const receipt=await service.prepareMaterials(input);
  await assert.rejects(()=>service.prepareMaterials({...input,materials:[{...input.materials[0],content:"43"}]}),/changed|conflict/i);
  assert.deepEqual((await service.status()).materials,receipt);
  const changed=new CompassStore(db);changed.setGoal({title:"Copy",successCriteria:["Changed condition"]});changed.close();
  await assert.rejects(()=>service.prepareMaterials(input),/Goal|goal/i);
  await assert.rejects(()=>service.continue(state.goalId!),/Goal|goal/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
