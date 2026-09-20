import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GovernedModelExecutor, createFunctionAdapter } from '../src/gai/model-execution.ts';
import { PersistentUsageLedger } from '../src/gai/usage-ledger.ts';
import { ModelRouterV2 } from '../src/jarvis/model-router-v2.ts';

const model={id:'local-model',local:true,modalities:['text' as const],quality:0.8,latencyMs:10,cost:0,ramGb:4,vramGb:0,allowedData:['confidential' as const],successRate:0.9,available:true};
const task={id:'routing',description:'test',difficulty:2,risk:'LOW' as const};
const routing={modality:'text' as const,dataClass:'confidential' as const,minQuality:0.7,localOnly:true,cloudBudget:0};
async function exercise(run:(ledger:PersistentUsageLedger)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'model-integration-'));try{await run(new PersistentUsageLedger(join(dir,'usage.json')));}finally{await rm(dir,{recursive:true,force:true});}}
const resources=()=>({availableRamGb:8,availableVramGb:0,observedAtMs:Date.now()});

test('resource-aware execution rejects insufficient memory before invoking model',async()=>exercise(async ledger=>{
 let calls=0;const adapter=createFunctionAdapter({tier:'local',provider:'local',planIncluded:true,describe:async()=>({model,resources:{...resources(),availableRamGb:1}}),run:async()=>{calls++;return 'bad';}});
 const executor=new GovernedModelExecutor([adapter],ledger);
 await assert.rejects(executor.execute({task,input:'x',routing}),/compatible|zero-cost/);assert.equal(calls,0);assert.equal((await ledger.list()).length,0);
}));

test('eligible real adapter executes and persists zero-cost outcome',async()=>exercise(async ledger=>{
 let calls=0;const adapter=createFunctionAdapter({tier:'local',provider:'local',planIncluded:true,describe:async()=>({model,resources:resources()}),run:async()=>{calls++;return 'done';}});
 const result=await new GovernedModelExecutor([adapter],ledger).execute({task,input:'x',routing});assert.equal(result.output,'done');assert.equal(calls,1);assert.equal((await ledger.list())[0].additionalApiCost,0);
}));

test('strict routing fails closed for unknown/stale resource metadata and forbidden data',async()=>exercise(async ledger=>{
 for(const data of [undefined,{model,resources:{...resources(),observedAtMs:Date.now()-120000}},{model:{...model,allowedData:['public']},resources:resources()}]){
 let calls=0;const adapter=createFunctionAdapter({tier:'local',provider:'local',planIncluded:true,describe:data?async()=>data as never:undefined,run:async()=>{calls++;return 'bad';}});
 await assert.rejects(new GovernedModelExecutor([adapter],ledger).execute({task,input:'x',routing}));assert.equal(calls,0);
 }
}));

test('request budget cannot enable paid candidates or send credentials to a model',()=>{
 const router=new ModelRouterV2();const base={...routing,availableRamGb:8,availableVramGb:0,cloudBudget:100,localOnly:false};
 assert.equal(router.route(base,[{...model,local:false,cost:1}]).selected,null);
 assert.equal(router.route({...base,dataClass:'credentials'},[{...model,allowedData:['credentials']}]).selected,null);
 assert.equal(router.route({...base,dataClass:'secret'},[{...model,allowedData:['secret']}]).selected,null);
});

test('invalid metrics and resource values cannot gain eligibility',()=>{
 const router=new ModelRouterV2(),base={...routing,availableRamGb:8,availableVramGb:0};
 for(const field of ['quality','latencyMs','cost','ramGb','vramGb','successRate'])assert.equal(router.route(base,[{...model,[field]:Number.NaN}]).selected,null);
 assert.equal(router.route({...base,minQuality:NaN},[model]).selected,null);
 assert.equal(router.route({...base,availableRamGb:-1},[model]).selected,null);
});
test('metadata is refreshed before execute and local identity cannot be spoofed',async()=>exercise(async ledger=>{
 let describes=0,calls=0;const adapter=createFunctionAdapter({tier:'local',provider:'local',planIncluded:true,describe:async()=>({model,resources:{...resources(),availableRamGb:++describes===1?8:0}}),run:async()=>{calls++;return 'bad';}});
 await assert.rejects(new GovernedModelExecutor([adapter],ledger).execute({task,input:'x',routing}));assert.equal(calls,0);assert.equal(describes,2);
 const spoof=createFunctionAdapter({tier:'local',provider:'local',planIncluded:true,describe:async()=>({model:{...model,local:false},resources:resources()}),run:async()=>{calls++;return 'bad';}});
 await assert.rejects(new GovernedModelExecutor([spoof],ledger).execute({task,input:'x',routing}));assert.equal(calls,0);
}));

test('frontier and fallback cannot bypass privacy or local-only constraints',async()=>exercise(async ledger=>{
 const calls:string[]=[];
 const adapters=[createFunctionAdapter({tier:'local',provider:'local',planIncluded:true,describe:async()=>({model,resources:resources()}),run:async()=>{calls.push('local');return 'safe';}}),createFunctionAdapter({tier:'astra',provider:'plan',planIncluded:true,describe:async()=>({model:{...model,local:false,quality:1,allowedData:['public']},resources:resources()}),run:async()=>{calls.push('astra');return 'bad';}})];
 const executor=new GovernedModelExecutor(adapters,ledger);
 await executor.execute({task:{...task,difficulty:10},input:'private',routing:{...routing,localOnly:false},allowFrontierEscalation:true});assert.deepEqual(calls,['local']);
 const old=process.env.LOCAL_ONLY;try{process.env.LOCAL_ONLY='true';await executor.execute({task:{...task,difficulty:10},input:'public',routing:{...routing,localOnly:false},allowFrontierEscalation:true});}finally{if(old===undefined)delete process.env.LOCAL_ONLY;else process.env.LOCAL_ONLY=old;}
 assert.deepEqual(calls,['local','local']);
}));

test('persisted outcomes calibrate ranking among authorized compatible adapters',async()=>exercise(async ledger=>{
 for(const [tier,success] of [['astra',false],['sol',true]] as const)await ledger.append({id:tier,taskId:'previous',requestedTier:tier,executedTier:tier,provider:tier,planIncluded:true,additionalApiCost:0,success,durationMs:10});
 const adapters=(['astra','sol'] as const).map(tier=>createFunctionAdapter({tier,provider:tier,planIncluded:true,describe:async()=>({model:{...model,local:false,quality:0.8},resources:resources()}),run:async()=>tier}));
 const result=await new GovernedModelExecutor(adapters,ledger).execute({task:{...task,difficulty:10},input:'x',routing:{...routing,localOnly:false},allowFrontierEscalation:true});
 assert.equal(result.executedTier,'sol');
}));


test('slow ledger cannot carry expired resource evidence into execution',async()=>exercise(async ledger=>{
 const now=Date.now;let clock=now(),reads=0,calls=0;const captured=clock;
 Date.now=()=>clock;
 const original=ledger.list.bind(ledger);ledger.list=async()=>{if(++reads===2)clock+=61000;return original();};
 try{
 const adapter=createFunctionAdapter({tier:'local',provider:'local',planIncluded:true,describe:async()=>({model,resources:{...resources(),observedAtMs:captured}}),run:async()=>{calls++;return 'bad';}});
 await assert.rejects(new GovernedModelExecutor([adapter],ledger).execute({task,input:'x',routing}));assert.equal(calls,0);
 }finally{Date.now=now;}
}));
