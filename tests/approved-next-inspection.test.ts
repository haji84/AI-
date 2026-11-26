import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";

test("host-selected next-work inspection executes real local context without Builder or false completion",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"next-work-inspect-")),path=join(dir,"compass.sqlite"),db=new CompassStore(path);
 try{const row=db.setGoal({title:"Issue1218 implement the Owner utility",description:"Issue1218 implement source changes only after inspection",successCriteria:["Owner utility implementation and real acceptance verified"],constraints:["No credentials or production operations"]});const id=goalWorkStateId(compassGoalToLoopGoal(row));
  const adapter=new CompassGoalExecutionAdapter(path,{}, {},undefined,undefined,{inspectionOnly:true});
  const report=await adapter.run(id,{maxCycles:1,context:[{source:"authorized-task-context",summary:"Inspect this next task while retaining every unfinished criterion"}]});
  assert.equal(report.cycles.length,1);assert.equal(report.cycles[0]?.action?.capability,"context.inspect");assert.equal(report.cycles[0]?.result?.ok,true);
  const state=await new CompassWorkStateStoreAdapter(db).get(id);assert.ok(state);assert.equal(state.status==="COMPLETED",false);assert.equal(state.verificationResults.some(r=>r.passed),false);assert.equal(report.goalEvaluation?.achieved,false);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test("inspection restriction cannot silently replace a separately selected controller",()=>{
 assert.throws(()=>new CompassGoalExecutionAdapter(":memory:",{}, {useCore:true},undefined,undefined,{inspectionOnly:true}),/INSPECTION/);
});
