import assert from 'node:assert/strict';
import test from 'node:test';
const {structuredClone}=globalThis;
const module=await import('../scripts/goriq-g1-compass-mode-authorization.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const revision='a'.repeat(40),now=Date.parse('2026-11-15T15:00:00Z');
const opaque=()=>Object.freeze(Object.create(null));
function fixture(stage='mac') {
 assert.equal(typeof module.validateModeRepairEvidence,'function');
 const repository={full_name:'haji84/AI-',id:1338437857};
 const actor={login:'haji84'};
 const ci={id:12345,workflow_id:337018160,name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:revision,
  status:'completed',conclusion:'success',run_attempt:1,repository,head_repository:repository,actor,triggering_actor:actor};
 const run={id:67890,name:'GORIQ Approved Two-Leaf Compass Repair',path:'.github/workflows/goriq-g1-compass-mode-repair.yml',
  event:'workflow_run',head_branch:'main',head_sha:revision,status:'in_progress',conclusion:null,run_attempt:1,repository,head_repository:repository,actor,triggering_actor:actor};
 const ciJobs={total_count:4,jobs:['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].map((name,index)=>({id:10+index,name,run_id:12345,run_attempt:1,head_sha:revision,status:'completed',conclusion:'success',steps:name==='independent-verifier-container'?[{name:'Real restricted-container six-check verification',status:'completed',conclusion:'success'},{name:'Retain hosted-container evidence',status:'completed',conclusion:'success'}]:[]}))};
 return {stage,now,context:{actions:'true',repository:'haji84/AI-',actor:'haji84',triggeringActor:'haji84',eventName:'workflow_run',ref:'refs/heads/main',revision,runId:'67890',runAttempt:'1',workflowRef:'haji84/AI-/.github/workflows/goriq-g1-compass-mode-repair.yml@refs/heads/main',runnerName:stage==='mac'?'MacBook':'GitHub Actions 1',runnerOS:stage==='mac'?'macOS':'Linux',runnerEnvironment:stage==='mac'?'self-hosted':'github-hosted',platform:stage==='mac'?'darwin':'linux'},
  event:{repository,workflow_run:ci},main:{object:{type:'commit',sha:revision}},ci,ciJobs,run,
  pr:{number:1918,state:'closed',merged:true,draft:false,merge_commit_sha:revision,user:actor,merged_by:actor,base:{ref:'main',repo:repository},head:{ref:'work/1219-g1-permission-proposal-20261115',repo:repository,sha:'b'.repeat(40)}},
  runJobs:{total_count:2,jobs:[{id:20,name:'authorize',run_id:67890,run_attempt:1,head_sha:revision,status:stage==='mac'?'completed':'in_progress',conclusion:stage==='mac'?'success':null,runner_id:100,runner_name:'GitHub Actions 1',labels:['ubuntu-latest']},
   {id:21,name:'repair',run_id:67890,run_attempt:1,head_sha:revision,status:'in_progress',conclusion:null,runner_id:22,runner_name:'MacBook',runner_group_id:1,labels:['self-hosted','macOS','ARM64']} ]}};
}
test('exact protected-merge source and observed owner Mac admit only this maintenance operation',()=>{
 for(const stage of ['hosted','mac']) {
  const f=fixture(stage),result=module.validateModeRepairEvidence(f);
  assert.equal(result.sourceRevision,revision);assert.equal(result.ciRunId,'12345');assert.equal(result.workflowRunId,'67890');
  assert.equal(result.productionAcceptance,false);assert.equal(result.originalGoalRecovered,false);assert.ok(Object.isFrozen(result));
 }
});
const mutations={
 'different repository':f=>{f.context.repository='other/repo';},
 'different actor':f=>{f.context.actor='attacker';},
 'different trigger actor':f=>{f.ci.triggering_actor={login:'attacker'};},
 'fork CI':f=>{f.ci.head_repository={full_name:'other/AI-',id:1};},
 'PR event':f=>{f.ci.event='pull_request';},
 'dispatch entry':f=>{f.context.eventName='workflow_dispatch';},
 'other CI workflow':f=>{f.ci.path='.github/workflows/other.yml';},
 'other workflow ID':f=>{f.ci.workflow_id=9;},
 'source changed':f=>{f.main.object.sha='c'.repeat(40);},
 'another PR':f=>{f.pr.number=1919;},
 'unmerged PR':f=>{f.pr.merged=false;},
 'wrong merge revision':f=>{f.pr.merge_commit_sha='d'.repeat(40);},
 'draft PR':f=>{f.pr.draft=true;},
 'other PR author':f=>{f.pr.user={login:'attacker'};},
 'missing CI job':f=>{f.ciJobs.jobs.pop();},
 'duplicate CI job':f=>{f.ciJobs.jobs[3]=f.ciJobs.jobs[0];},
 'skipped CI job':f=>{f.ciJobs.jobs[1].conclusion='skipped';},
 'failed CI':f=>{f.ci.conclusion='failure';},
 'old attempt job':f=>{f.ciJobs.jobs[0].run_attempt=2;},
 'other job source':f=>{f.ciJobs.jobs[0].head_sha='e'.repeat(40);},
 'missing six-check execution':f=>{f.ciJobs.jobs[2].steps=[];},
 'skipped six-check':f=>{f.ciJobs.jobs[2].steps[0].conclusion='skipped';},
 'entry replay':f=>{f.context.runAttempt='2';},
 'API entry replay':f=>{f.run.run_attempt=2;},
 'other executing runner':f=>{f.runJobs.jobs[1].runner_id=23;},
 'other runner name':f=>{f.context.runnerName='other';},
 'wrong native OS':f=>{f.context.platform='linux';},
 'hosted impersonating native':f=>{f.context.runnerEnvironment='github-hosted';},
 'unpassed hosted gate':f=>{f.runJobs.jobs[0].conclusion='skipped';},
 'expired fixed approval':f=>{f.now=Date.parse('2026-11-15T20:40:55Z');},
 'clock before approval':f=>{f.now=Date.parse('2026-11-15T14:40:54Z');},
 'API own run mismatch':f=>{f.run.id=67891;},
 'event run mismatch':f=>{f.event=structuredClone(f.event);f.event.workflow_run.id=12346;},
 'incomplete pagination':f=>{f.ciJobs.total_count=101;},
};
for(const [name,change] of Object.entries(mutations))test(name+' refuses before native capability',()=>{
 const f=fixture();change(f);assert.throws(()=>module.validateModeRepairEvidence(f),/^Error: MODE_ENTRY_[A-Z_]+$/);
});

function gateFixture() {
 assert.equal(typeof module.createSpecificModeGate,'function');
 let clock=now,fresh=true,claimed=0,expireDuringSource=false,failClaim=false;
 const scope={sourceRevision:revision,artifactDigest:'f'.repeat(64),hostId:'PRIVATE_HOST',ownerUid:501,expiresAt:now+30000};
 const evidence=module.validateModeRepairEvidence(fixture());
 const gate=module.createSpecificModeGate({evidence,scope,now:()=>clock,verifySource:async()=>{if(!fresh)throw Error('source changed');if(expireDuringSource)clock=scope.expiresAt;},
  claim:async()=>{claimed++;if(failClaim)throw Error('claim outcome unknown');return opaque();}});
 const plan=opaque(),binding=Object.freeze({plan,proposalDigest:'1'.repeat(64),factsDigest:'2'.repeat(64),...scope,
  operation:'compass-mode-narrowing',permissionChange:true,risk:'HIGH',requiresHumanApproval:true});
 return {gate,binding,scope,claimed:()=>claimed,setClock:v=>{clock=v;},changeSource:()=>{fresh=false;},expireDuringSource:()=>{expireDuringSource=true;},failClaim:()=>{failClaim=true;}};
}
test('specific gate binds only its opaque permit, consumes durable claim once and checks current authority',async()=>{
 const f=gateFixture(),receipt=await f.gate.gate.consume(f.gate.permit,f.binding);
 assert.equal(f.claimed(),1);assert.ok(Object.isFrozen(receipt));assert.equal(Object.getPrototypeOf(receipt),null);
 assert.equal(await f.gate.gate.verify(receipt,f.binding,'apply'),receipt);
 assert.equal(await f.gate.gate.verify(receipt,f.binding,'rollback'),receipt);
 await assert.rejects(f.gate.gate.consume(f.gate.permit,f.binding));assert.equal(f.claimed(),1);
 f.changeSource();await assert.rejects(f.gate.gate.verify(receipt,f.binding,'apply'));
});
test('JSON and copied source evidence cannot construct production authority',()=>{
 const f=gateFixture();assert.throws(()=>module.createSpecificModeGate({evidence:structuredClone(module.validateModeRepairEvidence(fixture())),scope:f.scope,now:()=>now,verifySource:async()=>{},claim:async()=>opaque()}));
});
for(const [name,mutate] of [
 ['JSON permit',f=>[{},f.binding]],['other opaque permit',f=>[opaque(),f.binding]],
 ['source',f=>[f.gate.permit,Object.freeze({...f.binding,sourceRevision:'b'.repeat(40)})]],
 ['owner',f=>[f.gate.permit,Object.freeze({...f.binding,ownerUid:0})]],
 ['expiry',f=>[f.gate.permit,Object.freeze({...f.binding,expiresAt:f.scope.expiresAt+1})]],
 ['operation',f=>[f.gate.permit,Object.freeze({...f.binding,operation:'other'})]],
 ['permission classification',f=>[f.gate.permit,Object.freeze({...f.binding,permissionChange:false})]],
])test('specific gate rejects '+name+' without durable consumption',async()=>{
 const f=gateFixture(),args=mutate(f);await assert.rejects(f.gate.gate.consume(...args));assert.equal(f.claimed(),0);
});
test('expiry before consume cannot consume authority',async()=>{
 const f=gateFixture();f.setClock(f.scope.expiresAt);await assert.rejects(f.gate.gate.consume(f.gate.permit,f.binding));assert.equal(f.claimed(),0);
});
test('expiry during awaited source verification refuses consumption before durable claim',async()=>{
 const f=gateFixture();f.expireDuringSource();await assert.rejects(f.gate.gate.consume(f.gate.permit,f.binding));assert.equal(f.claimed(),0);
});
test('expiry during awaited source verification rejects an existing consumed receipt',async()=>{
 const f=gateFixture(),receipt=await f.gate.gate.consume(f.gate.permit,f.binding);f.expireDuringSource();
 await assert.rejects(f.gate.gate.verify(receipt,f.binding,'apply'));assert.equal(f.claimed(),1);
});
test('unknown durable claim outcome cannot replay consumption or produce a receipt',async()=>{
 const f=gateFixture();f.failClaim();await assert.rejects(f.gate.gate.consume(f.gate.permit,f.binding));
 await assert.rejects(f.gate.gate.consume(f.gate.permit,f.binding));assert.equal(f.claimed(),1);
});
