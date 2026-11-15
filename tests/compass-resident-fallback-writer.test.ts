import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";
import { createCompassResidentExecutionAuthority } from "../src/orchestrator/compass-resident-execution-authority.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { acquireResidentExecutionWriter, ResidentExecutionBusyError } from "../src/orchestrator/resident-development-admission.ts";

for(const supplied of [false,true])test(`Compass non-Resident delegation retains the real ${supplied?"supplied":"owned"} writer until its awaited loop finishes`,async t=>{
  const root=mkdtempSync(join(tmpdir(),"compass-fallback-writer-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,"compass.db"),db=new CompassStore(path);
  db.setGoal({title:"Inspect fixture context",description:"No external effects",successCriteria:["inspect metadata"],constraints:[]});
  const goalId=goalWorkStateId(compassGoalToLoopGoal(db.getGoal()!));await new CompassWorkRunStore(db).put(createQueuedWorkRun(goalId));db.close();
  const authority=createCompassResidentExecutionAuthority({compassPath:path}),leasePath=path+".cognitive-run.lock";
  const writer=supplied?await acquireResidentExecutionWriter(leasePath,goalId):undefined;
  const outer=new CompassGoalExecutionAdapter(path,{}, {},{authority,writer,runtime:{matches:()=>false,async run(){assert.fail("unmatched Resident must not execute");}}});
  const original=CompassGoalExecutionAdapter.prototype.run;let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  CompassGoalExecutionAdapter.prototype.run=async function(id,input){if(this!==outer){enter();await gate;}return original.call(this,id,input);};
  const pending=outer.run(goalId);let competitor:Awaited<ReturnType<typeof acquireResidentExecutionWriter>>|undefined;
  try{
    await entered;
    // A native release unlinks metadata asynchronously. Keep the delegated
    // loop gated while allowing that release to finish before probing again.
    const deadline=Date.now()+150;
    do{
      await new Promise(resolve=>setTimeout(resolve,5));
      try{competitor=await acquireResidentExecutionWriter(leasePath,goalId);}catch(error){assert.ok(error instanceof ResidentExecutionBusyError);}
    }while(!competitor&&Date.now()<deadline);
    assert.equal(competitor,undefined,"delegation cannot release the writer while its generic loop is pending");
  }finally{await competitor?.release();release();await pending;writer?.assertHeld();CompassGoalExecutionAdapter.prototype.run=original;await writer?.release();}
});
