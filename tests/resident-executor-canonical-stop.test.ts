import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";

test("actual Resident CLI cannot clear an existing canonical WorkRun blocker during startup or catch",async t=>{
  const root=mkdtempSync(join(tmpdir(),"resident-cli-stop-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,"compass.db"),db=new CompassStore(path);
  db.setGoal({title:"Implement bounded source fix",description:"No network effects",successCriteria:["verified source"],constraints:[]});
  const goalId=goalWorkStateId(compassGoalToLoopGoal(db.getGoal()!));
  await new CompassWorkRunStore(db).put({...createQueuedWorkRun(goalId),blockers:["owner-stop"],evidenceRefs:["retained"]});db.close();
  spawnSync(process.execPath,["scripts/jarvis-goal-executor.ts"],{cwd:process.cwd(),encoding:"utf8",timeout:10000,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
    NODE_ENV:"test",JARVIS_GOAL_EXECUTION_GOAL_ID:goalId,JARVIS_GOAL_EXECUTION_COMPASS_PATH:path,GORIQ_SELF_DEVELOPMENT_RUNTIME:"1",
    GORIQ_SELF_DEVELOPMENT_TARGET_FILES:"src/orchestrator/goal-loop.ts"}});
  const reopened=new CompassStore(path);try{const run=await new CompassWorkRunStore(reopened).getByGoal(goalId);
    assert.ok(run!.blockers.includes("owner-stop"));assert.deepEqual(run!.evidenceRefs,["retained"]);
  }finally{reopened.close();}
});
