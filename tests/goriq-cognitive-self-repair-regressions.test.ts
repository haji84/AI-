import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

test("explicit null cycle budget is rejected before creating Compass state",async t=>{
  const root=mkdtempSync(join(tmpdir(),"cognitive-null-budget-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,"missing.db");
  await assert.rejects(new CognitiveService(path).continue("goal-0000000000000000",{maxCycles:null as unknown as number}),/maxCycles/);
  assert.equal(existsSync(path),false);
});

test("status stops reporting completed material after output tampering without changing its Goal",async t=>{
  const root=mkdtempSync(join(tmpdir(),"cognitive-status-output-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dbPath=join(root,"compass.db"),dataRoot=join(root,"data");mkdirSync(dataRoot);
  const db=new CompassStore(dbPath),record=db.setGoal({title:"Faithful retained text",successCriteria:["Saved text matches supplied material"]});db.close();
  const goalId=goalWorkStateId(compassGoalToLoopGoal(record)),service=new CognitiveService(dbPath,{materialIntake:{dataRoot}});
  const status=await service.status();
  await service.prepareMaterials({goalId,goalDigest:status.goalDigest!,mappingAcknowledged:true,materials:[{format:"text",content:"retained output",criteria:["criterion-1"]}]});
  assert.equal((await service.continue(goalId)).goalEvaluation?.achieved,true);
  assert.equal((await service.status()).goalComplete,true);
  const directory=join(root,"cognitive","material-intake"),receipt=JSON.parse(readFileSync(join(directory,readdirSync(directory)[0]!),"utf8"));
  writeFileSync(join(dataRoot,receipt.manifest.outcomes[0].path),"tampered output");
  const changed=await service.status();assert.equal(changed.goalComplete,false);assert.equal(changed.mode,"DEGRADED");assert.ok(changed.blockers.length);
  const after=new CompassStore(dbPath);try{assert.deepEqual(after.getGoal(),record);}finally{after.close();}
});
