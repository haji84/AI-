import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./preflight.mjs',import.meta.url));
function recommendation(input){
  const r=spawnSync(process.execPath,[script,'--input',JSON.stringify(input)],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
const base={cpuCount:16,availableMemoryGiB:12,totalMemoryGiB:32,independentTasks:6,quotaRemainingPercent:90,sessionCap:6,projectMaxActiveAgents:3,loadPerCpu:0.1};
test('admission respects project total active limit separately from child limit',()=>{
  assert.equal(recommendation(base).recommendedChildren,2);
});
test('memory, host load, quota and dependency count reduce actual concurrency',()=>{
  assert.equal(recommendation({...base,availableMemoryGiB:3}).recommendedChildren,0);
  assert.equal(recommendation({...base,loadPerCpu:0.95}).recommendedChildren,1);
  assert.equal(recommendation({...base,quotaRemainingPercent:0}).recommendedChildren,0);
  assert.equal(recommendation({...base,quotaRemainingPercent:5}).recommendedChildren,1);
  assert.equal(recommendation({...base,independentTasks:0}).recommendedChildren,0);
});
test('a larger unloaded host can admit more without a project cap; invalid metrics fail closed',()=>{
  assert.equal(recommendation({...base,projectMaxActiveAgents:null,availableMemoryGiB:24}).recommendedChildren,4);
  const r=spawnSync(process.execPath,[script,'--input','{"cpuCount":-1}'],{encoding:'utf8'});assert.notEqual(r.status,0);
});
