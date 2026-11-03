import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { setInterval, clearInterval } from 'node:timers';
const { AbortSignal }=globalThis;
import * as native from '../scripts/goriq-mac-private-dashboard-native.mjs';
import { executeDashboardRepair } from '../scripts/goriq-mac-private-dashboard.mjs';

const host='private-node.private-tail.ts.net', marker='PRIVATE_SECRET_DO_NOT_LOG';
const route=()=>({TCP:{443:{HTTPS:true}},Web:{[host+':443']:{Handlers:{'/':{Proxy:'http://127.0.0.1:3000'}}}}});
const valid=()=>({host,serve:async()=>route(),services:async()=>({version:'0.0.1'})});
const response=(text='{"status":"ok"}',status=200)=>({status,body:{getReader:()=>({
  read:async function(){if(this.done)return {done:true};this.done=true;return {value:Buffer.from(text),done:false};},
  cancel:async()=>{},releaseLock:()=>{}
})}});
const records=()=>{const rows=[];return {rows,report:row=>rows.push(row)};};
function assertSafe(rows) {
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_SECRET|private-node|private-tail|https?:|stack|stderr|stdout/);
  for(const row of rows) {
    assert.deepEqual(Object.keys(row).sort(),['version','issue','stage','outcome','reason','elapsedMs',...(row.httpStatus===undefined?[]:['httpStatus'])].sort());
    assert.equal(row.version,1);assert.equal(row.issue,1662);
    assert.ok(['serve-config','services-config','https-health'].includes(row.stage));
    assert.ok(['pass','fail'].includes(row.outcome));
    assert.ok(Number.isInteger(row.elapsedMs) && row.elapsedMs>=0 && row.elapsedMs<=60000);
    if(row.httpStatus!==undefined)assert.ok(Number.isInteger(row.httpStatus) && row.httpStatus>=100 && row.httpStatus<=599);
  }
}

test('private-health diagnostics are available without changing strict successful checks',async t=>{
  assert.equal(typeof native.verifyDashboardPrivateRoute,'function');
  const seen=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
    seen.push(url);assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    return response();
  });
  const log=records();await native.verifyDashboardPrivateRoute(valid(),log.report);
  assert.deepEqual(seen,['https://'+host+'/api/health']);
  assert.deepEqual(log.rows.map(r=>[r.stage,r.outcome,r.reason]),[
    ['serve-config','pass','verified'],['services-config','pass','verified'],['https-health','pass','verified']]);
  assertSafe(log.rows);
});

test('configuration diagnostics preserve short circuit and never serialize config or command errors',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{assert.fail('must not request health');});
  for(const stage of ['serve-config','services-config'])for(const throws of [false,true]) {
    const log=records(),calls=[];
    const fault=Object.assign(Error(marker+' '+host),{stdout:marker,stderr:marker,code:marker});
    const options={host,serve:async()=>{calls.push('serve');if(stage==='serve-config'){if(throws)throw fault;return {secret:marker};}return route();},
      services:async()=>{calls.push('services');if(throws)throw fault;return {version:'0.0.1',services:{[marker]:{}}};}};
    await assert.rejects(()=>native.verifyDashboardPrivateRoute(options,log.report),throws?e=>e===fault:/PRIVATE_ROUTE_REJECTED/);
    assert.deepEqual(calls,stage==='serve-config'?['serve']:['serve','services']);
    assert.equal(log.rows.at(-1).stage,stage);assert.equal(log.rows.at(-1).outcome,'fail');
    assert.equal(log.rows.at(-1).reason,throws?'query-failed':'configuration-mismatch');assertSafe(log.rows);
  }
});

test('HTTPS diagnostic keeps HTTP, body, JSON and application health failures distinct',async t=>{
  for(const [body,status,reason] of [[marker,503,'http-status'],[marker,200,'invalid-json'],
    ['{"status":"'+marker+'"}',200,'status-not-ok'],['x'.repeat(65537),200,'body-too-large']]) {
    t.mock.method(globalThis,'fetch',async()=>response(body,status));
    const log=records();await assert.rejects(()=>native.verifyDashboardPrivateRoute(valid(),log.report));
    assert.equal(log.rows.at(-1).stage,'https-health');assert.equal(log.rows.at(-1).reason,reason);
    if(reason==='http-status')assert.equal(log.rows.at(-1).httpStatus,503);
    assertSafe(log.rows);t.mock.restoreAll();
  }
});

test('HTTPS diagnostic allowlists network classes without raw errors or credentials',async t=>{
  for(const [code,reason] of [['ENOTFOUND','dns-failed'],['EAI_AGAIN','dns-failed'],
    ['CERT_HAS_EXPIRED','tls-failed'],['ERR_TLS_CERT_ALTNAME_INVALID','tls-failed'],
    ['ECONNREFUSED','connection-failed'],['ECONNRESET','connection-failed'],['UNKNOWN_'+marker,'network-failed']]) {
    const fault=Object.assign(Error(marker+' '+host),{cause:{code,message:marker,hostname:host},stack:marker});
    t.mock.method(globalThis,'fetch',async()=>{throw fault;});const log=records();
    await assert.rejects(()=>native.verifyDashboardPrivateRoute(valid(),log.report),e=>e===fault);
    assert.equal(log.rows.at(-1).reason,reason);assertSafe(log.rows);t.mock.restoreAll();
  }
});

test('HTTPS timeout stays at five seconds and fails without leaking abort details',async t=>{
  const original=AbortSignal.timeout,delays=[];
  t.mock.method(AbortSignal,'timeout',ms=>{delays.push(ms);return original(1);});
  t.mock.method(globalThis,'fetch',async(_url,{signal})=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    // Keep this fixture alive while the native unref-ed timeout signal fires.
    const handle=setInterval(()=>{},10);signal.addEventListener('abort',()=>clearInterval(handle),{once:true});
  }));
  const log=records();await assert.rejects(()=>native.verifyDashboardPrivateRoute(valid(),log.report));
  assert.deepEqual(delays,[5000]);assert.equal(log.rows.at(-1).reason,'timeout');assertSafe(log.rows);
});

test('diagnostic sink failures cannot change successful or rejected health outcomes',async t=>{
  const report=()=>{throw Error(marker);};
  t.mock.method(globalThis,'fetch',async()=>response());await native.verifyDashboardPrivateRoute(valid(),report);
  t.mock.restoreAll();t.mock.method(globalThis,'fetch',async()=>response(marker,503));
  await assert.rejects(()=>native.verifyDashboardPrivateRoute(valid(),report),/HEALTH_REJECTED/);
});

test('diagnostic integration preserves activation and rollback decisions and existing private-health failure stage',async t=>{
  const revision='a'.repeat(40),now=Date.parse('2026-10-05T12:31:33Z'),artifacts={fixture:'b'.repeat(40)};
  const approval={version:1,issue:1662,goalIssue:1219,owner:'haji84',nodeId:'macbook',platform:'macos',operation:'private-dashboard-loopback-and-tailnet-https',
    approvedAt:'2026-10-05T12:31:33Z',expiresAt:'2026-10-06T12:31:33Z',evidence:'https://github.com/haji84/AI-/issues/1662#issuecomment-5994510905',
    dashboardPort:3000,httpsPort:443,sourceBinding:'current-main-successful-ci',artifacts};
  const snapshot={platform:'darwin',uid:501,revision,exactMainCi:true,sourceClean:true,protectedSurfaces:true,existingCredentialsReady:true,existingStateReady:true,
    androidCount:38,releaseBuilt:true,brokerHealthy:true,brokerRevision:revision,dashboardAbsent:true,labelAbsent:true,host,backendState:'Running',serve:null,services:{version:'0.0.1'}};
  for(const healthy of [true,false])for(const restored of [true,false]) {
    t.mock.method(globalThis,'fetch',async()=>response(healthy?'{"status":"ok"}':marker,healthy?200:503));
    const calls=[],log=records(),ops={backup:async()=>calls.push('backup'),recheck:async()=>{calls.push('recheck');return snapshot;},
      startDashboard:async()=>calls.push('start'),verifyDashboard:async()=>calls.push('loopback'),createRoute:async()=>calls.push('route'),
      verifyRoute:()=>native.verifyDashboardPrivateRoute(valid(),log.report),verifyPreservation:async()=>calls.push('preserve'),
      recover:async state=>{calls.push('recover');assert.deepEqual(state,{dashboardAttempted:true,routeAttempted:true});return {restored,recoveryBlocked:!restored};}};
    const result=await executeDashboardRepair({phase:'apply',snapshot,approval,artifacts,now},ops);
    assert.equal(result.complete,healthy);assert.equal(result.activationVerified,healthy);
    assert.equal(result.transportAcceptanceVerified,false);
    assert.deepEqual(calls,['backup','recheck','start','loopback','recheck','route',healthy?'preserve':'recover']);
    if(!healthy){assert.equal(result.failedStage,'private-health');assert.equal(result.restored,restored);assert.equal(result.recoveryBlocked,!restored);}
    assertSafe(log.rows);t.mock.restoreAll();
  }
});

test('missing response body and untrusted status values remain fail-closed and sanitized',async t=>{
  for(const [result,reason] of [[{status:200,body:null},'response-unavailable'],[response(marker,marker),'http-status']]) {
    t.mock.method(globalThis,'fetch',async()=>result);const log=records();
    await assert.rejects(()=>native.verifyDashboardPrivateRoute(valid(),log.report));
    assert.equal(log.rows.at(-1).reason,reason);assert.equal(log.rows.at(-1).httpStatus,undefined);
    assertSafe(log.rows);t.mock.restoreAll();
  }
});

test('rejected body reads keep cancellation and reader release while preserving the original error',async t=>{
  const fault=Object.assign(Error(marker),{code:'ECONNRESET'}),calls=[];
  t.mock.method(globalThis,'fetch',async()=>({status:200,body:{getReader:()=>({
    read:async()=>{throw fault;},cancel:async()=>{calls.push('cancel');},releaseLock:()=>calls.push('release')
  })}}));
  const log=records();await assert.rejects(()=>native.verifyDashboardPrivateRoute(valid(),log.report),e=>e===fault);
  assert.deepEqual(calls,['cancel','release']);assert.equal(log.rows.at(-1).reason,'connection-failed');assertSafe(log.rows);
});
