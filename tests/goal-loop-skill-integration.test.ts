import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import { createWorkStateIntegratedGoalLoop } from "../src/orchestrator/work-state-integration.ts";
import type { WorkEvent, WorkState } from "../src/orchestrator/work-state.ts";
import type { ContextItem, WriteBackRecord } from "../src/orchestrator/goal-loop.ts";

const proposal={id:"report-check",name:"report check",description:"bounded check",procedure:"check report",applicability:["report"],confidence:0.8,evidenceRefs:["test:verified"],source:"local-executor"};
test("actual Goal Loop factory extracts verified candidates and supplies only certified Skills to planner",async()=>{
 const skills=new PersistentSkillLibrary(join(mkdtempSync(join(tmpdir(),"goal-skills-")),"skills.json"));
 let state:WorkState|null=null;const events:WorkEvent[]=[],records:WriteBackRecord[]=[],seen:ContextItem[][]=[];
 const goal={title:"report check",successCriteria:["checked"],constraints:[]};
 const create=()=>createWorkStateIntegratedGoalLoop({goal,skillLibrary:skills,
  planner:{inferIntent:async()=>({summary:"check",confidence:1,evidence:[]}),proposeNextAction:async({context})=>{seen.push(context);return {id:"check",description:"check",capability:"read",risk:"low"};}},
  contextSources:[],executor:{execute:async()=>({actionId:"check",ok:true,summary:"checked",reusableSkill:proposal})},verifier:{verify:async()=>({ok:true,summary:"verified"})},
  stateStore:{getState:async()=>({completed:[],blockers:[]}),writeBack:async(record)=>{records.push(record);}},
  workStateStore:{get:async()=>state,put:async(next)=>{state=next;},appendEvent:async(_id,event)=>{events.push(event);}}
 });
 await create().runCycle({goal});assert.equal((await skills.get(proposal.id))?.status,"candidate");assert.equal(seen[0].filter(i=>i.source==="gai-skills").length,0);
 await skills.certify(proposal.id,["independent:test"]);
 await create().runCycle({goal});assert.equal(seen[1].filter(i=>i.source==="gai-skills").length,1);
 assert.equal((await skills.get(proposal.id))?.status,"active","identical write-back must not demote a certified Skill");assert.equal(records.length,2);
});


test("corrupt optional Skill memory is visible and does not lose verified goal write-back",async()=>{
 const {writeFileSync}=await import('node:fs');const path=join(mkdtempSync(join(tmpdir(),'goal-skill-corrupt-')),'skills.json');writeFileSync(path,'invalid');
 const skills=new PersistentSkillLibrary(path);let state:WorkState|null=null;const events:WorkEvent[]=[],records:WriteBackRecord[]=[];let context:ContextItem[]=[];
 const goal={title:'report check',successCriteria:['checked'],constraints:[]};
 const loop=createWorkStateIntegratedGoalLoop({goal,skillLibrary:skills,
 planner:{inferIntent:async()=>({summary:'check',confidence:1,evidence:[]}),proposeNextAction:async(input)=>{context=input.context;return {id:'check',description:'check',capability:'read',risk:'low'};}},contextSources:[],executor:{execute:async()=>({actionId:'check',ok:true,summary:'checked',reusableSkill:proposal})},verifier:{verify:async()=>({ok:true,summary:'verified'})},
 stateStore:{getState:async()=>({completed:[],blockers:[]}),writeBack:async(r)=>{records.push(r);}},workStateStore:{get:async()=>state,put:async(s)=>{state=s;},appendEvent:async(_id,e)=>{events.push(e);}}
 });const result=await loop.runCycle({goal});assert.equal(result.result?.ok,true);assert.equal(records.length,1);assert.ok(events.some(e=>e.type==='skill_writeback_failed'));assert.ok(context.some(i=>i.summary.includes('unavailable')));
});
