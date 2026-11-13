import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { probeLiveGoriqConnection } from '../scripts/goriq-ai09-live-broker-builder-probe.mjs';

const { Response } = globalThis;
const credential='fixture-only-private-owner-credential';
const goalId='goal-fixture-readerror',jobId='job-fixture-readerror';
const valid={run:{goalId,phase:'RUNNING'},goalAuthority:{kind:'CURRENT_COMPASS_GOAL',goalId,current:true},
 jobReadback:{kind:'LOCAL_PERSISTED_JOBS',goalId,goalDigest:'a'.repeat(64),jobs:[{jobId,phase:'VERIFYING',recordSha256:'b'.repeat(64),approvalScope:{taskScopeId:'fixture-scope',maxRisk:'low',expiresAt:'2099-01-01T00:00:00.000Z'}}]}};
const ok=value=>new Response(JSON.stringify(value),{status:200});
async function run(failing, repeated=false, override={}){
 const requests=[];let selected=0;
 const result=await probeLiveGoriqConnection({mode:'broker',ownerToken:credential,goalId,jobId,
 fetchImpl:async(url,init)=>{
  requests.push({url,init});
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  assert.equal(new URL(url).hostname,'127.0.0.1');
  if(url.endsWith('/health'))return ok({ok:true,service:'jarvis-broker'});
  if(url.includes('/bridge/events?'))return ok({events:[]});
  assert.equal(url,`http://127.0.0.1:8787/api/jarvis/admin/work/${goalId}`);
  if(repeated&&selected++===0)return ok(valid);
  return failing();
 },...override});
 assert.ok(!JSON.stringify(result).includes(credential));
 return {result,requests};
}
for(const status of [301,401,403,404,409,429,500,503])test(`selected Goal HTTP ${status} retains a numeric status without leaking body or headers`,async()=>{
 let bodyRead=false;
 const {result,requests}=await run(()=>({ok:false,status,text:async()=>{bodyRead=true;return credential;}}));
 assert.equal(result.status,'HOLD');assert.equal(result.reason,'GOAL_RUN_NOT_AUTHENTICATED_OR_FOUND');
 assert.equal(result.brokerAuthenticated,true);assert.equal(result.goalWorkRunObserved,false);
 assert.deepEqual(result.readFailure,{kind:'HTTP',httpStatus:status});assert.equal(bodyRead,false);assert.equal(requests.length,3);
});
test('selected Goal transport failure does not copy exception text',async()=>{
 const {result,requests}=await run(()=>{throw Error(credential);});
 assert.deepEqual(result.readFailure,{kind:'TRANSPORT',httpStatus:null});assert.equal(requests.length,3);
});
test('invalid JSON is distinguished from an HTTP error without leaking the body',async()=>{
 const {result}=await run(()=>new Response('<html>'+credential+'</html>',{status:200}));
 assert.deepEqual(result.readFailure,{kind:'JSON',httpStatus:200});
});
test('oversized successful Goal response retains HOLD and the existing size bound',async()=>{
 const {result}=await run(()=>new Response('x'.repeat(16385)+credential,{status:200}));
 assert.deepEqual(result.readFailure,{kind:'SIZE',httpStatus:200});assert.equal(result.status,'HOLD');
});
test('failed response body read is distinct from invalid JSON',async()=>{
 const {result}=await run(()=>({ok:true,status:200,text:async()=>{throw Error(credential);}}));
 assert.deepEqual(result.readFailure,{kind:'BODY',httpStatus:200});
});
test('non-string body cannot become trusted Goal JSON',async()=>{
 const {result}=await run(()=>({ok:true,status:200,text:async()=>valid}));
 assert.deepEqual(result.readFailure,{kind:'BODY',httpStatus:200});
});
for(const status of [undefined,0,999,'404'])test(`nonstandard status ${String(status)} is never copied as arbitrary output`,async()=>{
 const {result}=await run(()=>({ok:false,status,text:async()=>credential}));
 assert.deepEqual(result.readFailure,{kind:'HTTP',httpStatus:null});
});
test('second Goal read reports its own failure with exactly one repeated GET',async()=>{
 const {result,requests}=await run(()=>new Response(credential,{status:503}),true);
 assert.equal(result.reason,'JOB_READBACK_REPEAT_UNAVAILABLE');assert.equal(requests.length,4);
 assert.deepEqual(result.readFailure,{kind:'HTTP',httpStatus:503});assert.equal(result.localReadbackConsistent,false);
});
test('stable valid Goal and Job readback retains existing success shape with no diagnostic authority',async()=>{
 const {result,requests}=await run(()=>ok(valid));
 assert.equal(result.status,'BROKER_AUTHENTICATED_READONLY');assert.equal(result.localReadbackConsistent,true);
 assert.equal(result.writeAuthorized,false);assert.equal(result.mergeAuthorized,false);assert.equal(requests.length,4);
 assert.equal(Object.hasOwn(result,'readFailure'),false);
});
test('connection-only path retains two requests and never performs a selected Goal read',async()=>{
 const {result,requests}=await run(()=>{throw Error('must not fetch selected Goal');},false,{goalId:undefined,jobId:undefined});
 assert.equal(result.status,'BROKER_AUTHENTICATED_READONLY');assert.equal(requests.length,2);assert.equal(result.goalWorkRunObserved,false);
});
test('owner authentication failure is still HOLD before Goal request',async()=>{
 let requests=0;const result=await probeLiveGoriqConnection({mode:'broker',ownerToken:credential,goalId,jobId,fetchImpl:async(url)=>{
  requests++;return url.endsWith('/health')?ok({ok:true,service:'jarvis-broker'}):new Response(credential,{status:401});
 }});
 assert.equal(result.reason,'OWNER_AUTHENTICATION_NOT_VERIFIED');assert.equal(result.brokerAuthenticated,false);assert.equal(requests,2);
 assert.equal(Object.hasOwn(result,'readFailure'),false);
});
