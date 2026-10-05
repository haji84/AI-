import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { validateDashboardApproval, emptyServeConfig, emptyServicesConfig, onlyDashboardRoute,
  executeDashboardRepair } from '../scripts/goriq-mac-private-dashboard.mjs';

const revision='a'.repeat(40), now=Date.parse('2026-10-05T12:31:33Z');
const artifacts={'scripts/goriq-mac-private-dashboard.mjs':'b'.repeat(40)};
const approval=()=>({version:1,issue:1662,goalIssue:1219,owner:'haji84',nodeId:'macbook',platform:'macos',
  operation:'private-dashboard-loopback-and-tailnet-https',approvedAt:'2026-10-05T12:31:33Z',
  expiresAt:'2026-10-06T12:31:33Z',evidence:'https://github.com/haji84/AI-/issues/1662#issuecomment-5994510905',
  dashboardPort:3000,httpsPort:443,sourceBinding:'current-main-successful-ci',artifacts});
const host='test-node.test-tail.ts.net';
const route=()=>({TCP:{443:{HTTPS:true}},Web:{[host+':443']:{Handlers:{'/':{Proxy:'http://127.0.0.1:3000'}}}}});
const baseline=()=>({platform:'darwin',uid:501,revision,exactMainCi:true,sourceClean:true,
  protectedSurfaces:true,existingCredentialsReady:true,existingStateReady:true,androidCount:38,
  releaseBuilt:true,brokerHealthy:true,brokerRevision:revision,dashboardAbsent:true,labelAbsent:true,
  host,backendState:'Running',serve:null,services:{version:'0.0.1'}});
function harness(changes={}) {
  const calls=[];
  const ops={backup:async()=>{calls.push('backup');},
    recheck:async()=>{calls.push('recheck');return baseline();},
    startDashboard:async()=>{calls.push('start-dashboard');},
    verifyDashboard:async()=>{calls.push('verify-dashboard');},
    createRoute:async()=>{calls.push('create-route');},
    verifyRoute:async()=>{calls.push('verify-route');},
    verifyPreservation:async()=>{calls.push('verify-preservation');},
    recover:async()=>{calls.push('recover');return {restored:true,recoveryBlocked:false};},
    ...changes};
  return {calls,ops};
}
const input=(phase='apply')=>({phase,snapshot:baseline(),approval:approval(),artifacts,now});
test('scope, issuer, future/expired/oversized approval and changed artifact fail closed',()=>{
  validateDashboardApproval(approval(),artifacts,now);
  for(const patch of [{nodeId:'zbook'},{platform:'windows'},{owner:'other'},{dashboardPort:8787},
    {httpsPort:8443},{operation:'public-funnel'},{expiresAt:'2026-10-05T12:31:33Z'},
    {approvedAt:'2026-10-05T12:31:34Z'},{expiresAt:'2026-10-07T12:31:33Z'},
    {artifacts:{...artifacts,'scripts/goriq-mac-private-dashboard.mjs':'c'.repeat(40)}}]) {
    assert.throws(()=>validateDashboardApproval({...approval(),...patch},artifacts,now));
  }
});
test('empty config means empty across all surfaces; malformed and unrelated routes are conflicts',()=>{
  for(const value of [null,{}, {TCP:{},Web:{},AllowFunnel:{},Foreground:{},Services:{}}]) assert.equal(emptyServeConfig(value),true);
  for(const value of [undefined,[],true,{Unknown:{}},{Web:{other:{}}},{Services:{other:{}}},
    {AllowFunnel:{other:false}},route()]) assert.equal(emptyServeConfig(value),false);
  assert.equal(emptyServicesConfig({version:'0.0.1'}),true);
  assert.equal(emptyServicesConfig({version:'0.0.1',services:{}}),true);
  for(const value of [null,{}, {version:'unexpected'}, {version:'0.0.1',services:{other:{}}}]) {
    assert.equal(emptyServicesConfig(value),false);
  }
});
test('owned route accepts only private HTTPS443 to loopback3000; extra ingress is never owned',()=>{
  assert.equal(onlyDashboardRoute(route(),host),true);
  for(const config of [{...route(),TCP:{443:{HTTPS:true},8443:{HTTPS:true}}},
    {...route(),AllowFunnel:{[host+':443']:true}},{...route(),Services:{other:{}}},
    {TCP:{443:{HTTPS:true}},Web:{[host+':443']:{Handlers:{'/':{Proxy:'http://127.0.0.1:8787'}}}}}]) {
    assert.equal(onlyDashboardRoute(config,host),false);
  }
});
test('read-only plan does not create baseline, files, services or routes',async()=>{
  const {calls,ops}=harness();const result=await executeDashboardRepair(input('plan'),ops);
  assert.deepEqual(calls,[]);assert.equal(result.readOnly,true);assert.equal(result.activationVerified,false);
});
test('failed source, identity/state, ownership, occupied port, broker revision or network blocks all mutation',async()=>{
  for(const patch of [{platform:'linux'},{uid:0},{exactMainCi:false},{sourceClean:false},
    {protectedSurfaces:false},{existingCredentialsReady:false},{existingStateReady:false},{androidCount:37},
    {releaseBuilt:false},{brokerRevision:'d'.repeat(40)},{dashboardAbsent:false},{labelAbsent:false},
    {backendState:'Stopped'},{serve:route()},{services:{version:'0.0.1',services:{other:{}}}}]) {
    const {calls,ops}=harness();await assert.rejects(()=>executeDashboardRepair({...input(),snapshot:{...baseline(),...patch}},ops));
    assert.deepEqual(calls,[]);
  }
});
test('successful activation backs up and rechecks before starting dashboard and creating scoped route',async()=>{
  const {calls,ops}=harness();const result=await executeDashboardRepair(input(),ops);
  assert.deepEqual(calls,['backup','recheck','start-dashboard','verify-dashboard','recheck','create-route','verify-route','verify-preservation']);
  assert.equal(result.activationVerified,true);assert.equal(result.transportAcceptanceVerified,false);
});
test('failed dashboard start and ambiguous failed Serve commands always enter recovery',async()=>{
  for(const operation of ['startDashboard','createRoute','verifyRoute']) {
    let recovery;
    const {calls,ops}=harness({[operation]:async()=>{throw Error('PRIVATE_SECRET_DO_NOT_LOG');},
      recover:async(state)=>{recovery=state;calls.push('recover');return {restored:true,recoveryBlocked:false};}});
    const result=await executeDashboardRepair(input(),ops);
    assert.equal(result.complete,false);assert.equal(result.restored,true);
    assert.equal(recovery.dashboardAttempted,true);
    assert.equal(recovery.routeAttempted,operation!=='startDashboard');
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SECRET/);
  }
});
test('concurrent route between checks does not get overwritten and blocked recovery stays visible',async()=>{
  let checks=0;
  const {calls,ops}=harness({recheck:async()=>{calls.push('recheck');return checks++?{...baseline(),serve:route()}:baseline();},
    recover:async()=>({restored:false,recoveryBlocked:true})});
  const result=await executeDashboardRepair(input(),ops);
  assert.equal(calls.includes('create-route'),false);
  assert.equal(result.recoveryBlocked,true);assert.equal(result.restored,false);
});

import { mkdtemp, writeFile, symlink, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseDashboardListeners, dashboardPlist, pathGuard } from '../scripts/goriq-mac-private-dashboard-native.mjs';
test('native listener parsing proves exact launchd PID and IPv4 loopback boundary',()=>{
  assert.deepEqual(parseDashboardListeners(''),[]);
  assert.deepEqual(parseDashboardListeners('p123\nn127.0.0.1:3000\n'),[{pid:123,loopback:true}]);
  assert.deepEqual(parseDashboardListeners('p123\nn*:3000\n'),[{pid:123,loopback:false}]);
  assert.throws(()=>parseDashboardListeners('n127.0.0.1:3000\n'));
  assert.throws(()=>parseDashboardListeners('permission denied'));
});
test('new plist starts dashboard only, XML escapes paths and never embeds credentials',()=>{
  const text=dashboardPlist({release:'/owner/a&b',node:'/node/bin/node',revision,dbPath:'/owner/state/db',home:'/owner'});
  assert.match(text,/a&amp;b/);assert.match(text,/private-dashboard/);
  assert.doesNotMatch(text,/jarvis-broker|remote-host|OWNER_TOKEN|OWNER_SECRET|privateKey/);
  assert.throws(()=>dashboardPlist({release:'relative',node:'/node',revision,dbPath:'/db',home:'/owner'}));
});
test('real owner filesystem boundaries reject symlinks and writable files without altering them',async()=>{
  if(typeof process.getuid!=='function')return;
  const root=await mkdtemp(join(homedir(),'.goriq-dashboard-fixture-'));
  try {
    await chmod(root,0o700);const file=join(root,'protected'),link=join(root,'link');
    await writeFile(file,'existing-state',{mode:0o600});
    await pathGuard(file,{secret:true});
    await symlink(file,link);await assert.rejects(()=>pathGuard(link,{secret:true}));
    await chmod(file,0o666);await assert.rejects(()=>pathGuard(file,{secret:true}));
  }finally{await rm(root,{recursive:true,force:true});}
});
