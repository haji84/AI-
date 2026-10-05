import test from 'node:test';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { validateDashboardApproval, emptyServeConfig, emptyServicesConfig, onlyDashboardRoute,
  executeDashboardRepair, stableFleetEnrollment, recoverDashboardSurfaces, validateDashboardAutomaticTrigger, dashboardFailureClass } from '../scripts/goriq-mac-private-dashboard.mjs';

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

import { mkdtemp, writeFile, symlink, chmod, rm, readFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseDashboardListeners, dashboardPlist, pathGuard, releaseInventory, verifyDashboardRelease, reuseStagedRelease, protectedOwnerPathFacts } from '../scripts/goriq-mac-private-dashboard-native.mjs';
test('native listener parsing proves exact launchd PID and IPv4 loopback boundary',()=>{
  assert.deepEqual(parseDashboardListeners(''),[]);
  assert.deepEqual(parseDashboardListeners('p123\nf20\nn127.0.0.1:3000\n'),[{pid:123,loopback:true}]);
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

import { createHash } from 'node:crypto';
const sha256=value=>createHash('sha256').update(value).digest('hex');
test('state preservation permits liveness updates but detects enrollment, membership and authority drift',()=>{
  const fleet=[{id:'android-1',kind:'android',enrollment:'full',fleetNumber:1,group:'owner',
    status:'online',lastSeenAt:'before',telemetry:{batteryPercent:50},nodeContract:{checkedAt:'before'}},
    {id:'macbook',kind:'macos',enrollment:'full',pcAuthority:{roles:['Coordinator']}}];
  const changed=JSON.parse(JSON.stringify(fleet));
  changed[0].lastSeenAt='after';changed[0].status='offline';changed[0].telemetry.batteryPercent=40;
  changed[0].nodeContract.checkedAt='after';
  assert.deepEqual(stableFleetEnrollment(fleet),stableFleetEnrollment(changed.reverse()));
  for(const mutation of [rows=>{rows[0].enrollment='quick';},rows=>{rows.pop();},
    rows=>{rows[1].pcAuthority.roles=['Executor'];}]) {
    const drift=JSON.parse(JSON.stringify(fleet));mutation(drift);
    assert.notDeepEqual(stableFleetEnrollment(fleet),stableFleetEnrollment(drift));
  }
});
function recoveryFixture(config=route(),changes={}) {
  const calls=[];let ingress=config,absent=false;
  const ops={serve:async()=>{calls.push('inspect-serve');return ingress;},
    services:async()=>({version:'0.0.1'}),dashboardWritten:async()=>true,ownedPlist:async()=>true,
    removeRoute:async()=>{calls.push('remove-route');ingress=null;},
    removeDashboard:async()=>{calls.push('unload-dashboard');absent=true;},
    dashboardAbsent:async()=>absent,retainPlist:async()=>{calls.push('retain-plist');},
    verifyState:async()=>{calls.push('verify-state');},...changes};
  return {calls,ops};
}
test('production recovery logic retains dashboard when ingress appeared before own Serve attempt',async()=>{
  for(const ingress of [route(),{Web:{other:{}}}]) {
    const {calls,ops}=recoveryFixture(ingress);
    const result=await recoverDashboardSurfaces({dashboardAttempted:true,routeAttempted:false,host},ops);
    assert.equal(result.recoveryBlocked,true);assert.equal(calls.includes('unload-dashboard'),false);
    assert.equal(calls.includes('remove-route'),false);
  }
});
test('production recovery removes only owned route before its dependent dashboard, then verifies state',async()=>{
  const {calls,ops}=recoveryFixture();
  const result=await recoverDashboardSurfaces({dashboardAttempted:true,routeAttempted:true,host},ops);
  assert.equal(result.restored,true);
  assert.ok(calls.indexOf('remove-route')<calls.indexOf('unload-dashboard'));
  assert.equal(calls.at(-1),'verify-state');
});
test('late concurrent ingress and Services prevent unloading even after owned route removal',async()=>{
  let reads=0;
  const {calls,ops}=recoveryFixture(null,{serve:async()=>reads++<2?null:route()});
  assert.equal((await recoverDashboardSurfaces({dashboardAttempted:true,routeAttempted:false,host},ops)).recoveryBlocked,true);
  assert.equal(calls.includes('unload-dashboard'),false);
  const second=recoveryFixture(null,{services:async()=>({version:'0.0.1',services:{other:{}}})});
  assert.equal((await recoverDashboardSurfaces({dashboardAttempted:true,routeAttempted:false,host},second.ops)).recoveryBlocked,true);
  assert.equal(second.calls.includes('unload-dashboard'),false);
});
test('fresh source or protected-state rejection before route creation enters actual safe recovery',async()=>{
  for(const failure of [{exactMainCi:false},{sourceClean:false},{existingStateReady:false},{androidCount:37}]) {
    let count=0;
    const recovery=recoveryFixture(null);
    const {calls,ops}=harness({recheck:async()=>count++?{...baseline(),...failure}:baseline(),
      recover:state=>recoverDashboardSurfaces({...state,host},recovery.ops)});
    const result=await executeDashboardRepair(input(),ops);
    assert.equal(result.complete,false);assert.equal(calls.includes('create-route'),false);
    assert.equal(result.restored,true);
  }
});
test('release provenance catches staged code/dependency tampering, escaping links and supports verified reuse',async()=>{
  if(typeof process.getuid!=='function')return;
  const root=await mkdtemp(join(homedir(),'.goriq-release-fixture-'));
  try {
    await chmod(root,0o700);
    const release=join(root,'release');await mkdir(release,{mode:0o700});
    const paths=['scripts/goriq-mac-private-dashboard.mjs','scripts/goriq-mac-private-dashboard-native.mjs',
      'scripts/goriq-mac-private-dashboard-entry.sh','.github/workflows/goriq-mac-private-dashboard.yml',
      'scripts/goriq-mac-owner-secret.mjs','scripts/goriq-owner-file-swap.py'];
    const bound={};
    for(const path of paths) {
      await mkdir(join(release,path.substring(0,path.lastIndexOf('/'))),{recursive:true,mode:0o700});
      const content='approved '+path;
      await writeFile(join(release,path),content,{mode:0o600});
      bound[path]=createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0').update(content).digest('hex');
    }
    const asset=join(release,'dependency.js');await writeFile(asset,'original dependency',{mode:0o600});
    const seal=join(root,'seal.json'),node=join(root,'node');
    await writeFile(node,'pinned node fixture',{mode:0o700});
    const manifest=JSON.stringify({version:1,revision,artifacts:bound,
      node:{path:node,sha256:sha256(await readFile(node))},inventory:await releaseInventory(release)});
    await writeFile(join(release,'release-manifest.json'),manifest,{mode:0o600});
    await writeFile(seal,JSON.stringify({version:1,revision,artifacts:bound,manifestSha256:sha256(manifest)}),{mode:0o600});
    const options={release,revision,seal,node,artifacts:bound};
    assert.equal(await reuseStagedRelease(options),true);
    await verifyDashboardRelease(options);
    await assert.rejects(()=>verifyDashboardRelease({...options,artifacts:{...bound,[paths[0]]:'f'.repeat(40)}}));
    await writeFile(asset,'modified dependency');
    await assert.rejects(()=>verifyDashboardRelease(options));assert.equal(await reuseStagedRelease(options),false);
    await writeFile(asset,'original dependency');
    await writeFile(join(release,paths[2]),'modified entry');
    await assert.rejects(()=>verifyDashboardRelease(options));
    await writeFile(join(release,paths[2]),'approved '+paths[2]);
    await symlink(process.execPath,join(release,'escaping-link'));
    await assert.rejects(()=>releaseInventory(release));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('expiry during awaited source/inventory checks blocks the subsequent dashboard or route mutation',async()=>{
  for(const expiresOnCheck of [1,2]) {
    let clock=now,checks=0;
    const {calls,ops}=harness({now:()=>clock,recheck:async()=>{
      if(++checks===expiresOnCheck)clock=Date.parse(approval().expiresAt);
      return baseline();
    }});
    const result=await executeDashboardRepair(input(),ops);
    assert.equal(result.complete,false);assert.equal(calls.includes('create-route'),false);
    if(expiresOnCheck===1)assert.equal(calls.includes('start-dashboard'),false);
  }
});

test('automatic activation binds owner Production Sync to exact merged PR1718; unrelated runs fail closed',()=>{
  const proof={revision,actor:'haji84',run:{name:'GORIQ JARVIS Production Sync',event:'workflow_run',status:'completed',conclusion:'success',
    head_branch:'main',head_sha:revision,actor:{login:'haji84'},head_repository:{full_name:'haji84/AI-'}},
    pullRequest:{number:1718,merged:true,merge_commit_sha:revision,base:{ref:'main',repo:{full_name:'haji84/AI-'}},user:{login:'haji84'}}};
  validateDashboardAutomaticTrigger(proof);
  for(const mutate of [p=>{p.actor='other';},p=>{p.run.actor.login='other';},p=>{p.run.conclusion='failure';},
    p=>{p.run.head_sha='f'.repeat(40);},p=>{p.pullRequest.merge_commit_sha='f'.repeat(40);},
    p=>{p.pullRequest.number=1713;},p=>{p.pullRequest.merged=false;},p=>{p.run.head_branch='feature';},
    p=>{p.run.head_repository.full_name='other/AI-';},p=>{p.run.name='CI';},p=>{p.pullRequest.base.ref='feature';},p=>{p.run.event='schedule';},p=>{p.run.event='push';}]) {
    const changed=JSON.parse(JSON.stringify(proof));mutate(changed);
    assert.throws(()=>validateDashboardAutomaticTrigger(changed));
  }
});

test('ambiguous partial plist write never claims restored or removes a file without ownership proof',async()=>{
  const {calls,ops}=recoveryFixture(null,{ownedPlist:async()=>false});
  const result=await recoverDashboardSurfaces({dashboardAttempted:true,routeAttempted:false,host},ops);
  assert.equal(result.restored,false);assert.equal(result.recoveryBlocked,true);
  assert.equal(calls.includes('unload-dashboard'),false);assert.equal(calls.includes('retain-plist'),false);
});

test('native prerequisite classification exposes only fixed failure codes and never exception text',()=>{
  assert.equal(dashboardFailureClass(Error('OWNER_AUTH_REJECTED')),'OWNER_AUTH_REJECTED');
  assert.equal(dashboardFailureClass(Error('NATIVE_PARENT_ACL_REJECTED')),'NATIVE_PARENT_ACL_REJECTED');
  for(const value of [Error('private-token SECRET_VALUE'),Error('/private/owner/path'),{message:'OWNER_AUTH_REJECTED'}]) {
    assert.equal(dashboardFailureClass(value),'MAC_PRIVATE_DASHBOARD_PREREQUISITE_REJECTED');
    assert.doesNotMatch(dashboardFailureClass(value),/SECRET_VALUE|private\/owner/);
  }
});
test('read-only environment boundary metadata uses anonymous surface references',async()=>{
  if(typeof process.getuid!=='function')return;
  const root=await mkdtemp(join(homedir(),'.goriq-boundary-fixture-'));
  try {
    await chmod(root,0o700);const file=join(root,'owner-environment');await writeFile(file,'SECRET_VALUE',{mode:0o600});
    const facts=await protectedOwnerPathFacts(file);
    assert.equal(facts[0].surface,'environment');assert.equal(facts[0].ownerClass,'current-user');
    assert.equal(facts[0].privateMode,true);assert.equal(facts[1].directory,true);
    assert.equal(JSON.stringify(facts).includes(root),false);
    assert.doesNotMatch(JSON.stringify(facts),/SECRET_VALUE|owner-environment/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('preparation failures distinguish sealing and runtime provenance without revealing captured details',()=>{
  const codes=['BUILD_TOOLCHAIN_REJECTED','RELEASE_ACL_REJECTED','RELEASE_ARTIFACT_REJECTED',
    'RELEASE_ITEM_REJECTED','RELEASE_LINK_REJECTED','RELEASE_MUTABLE_LINK_REJECTED',
    'RELEASE_NODE_ACL_REJECTED','RELEASE_NODE_PARENT_REJECTED','RELEASE_NODE_REJECTED','RELEASE_OWNER_REJECTED'];
  for(const code of codes) {
    const error=Object.assign(Error(code),{stdout:'SECRET_VALUE /private/owner/path',stderr:'PRIVATE_DNS example.ts.net'});
    assert.equal(dashboardFailureClass(error),code);
    assert.doesNotMatch(dashboardFailureClass(error),/SECRET_VALUE|private\/owner|PRIVATE_DNS|example/);
    assert.equal(dashboardFailureClass(Error(code+' /private/owner/path')),'MAC_PRIVATE_DASHBOARD_PREREQUISITE_REJECTED');
  }
});
