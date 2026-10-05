import { isDeepStrictEqual } from 'node:util';

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const empty=value=>object(value) && Object.keys(value).length===0;
export function emptyServeConfig(value) {
  return value===null || (object(value) && Object.entries(value).every(([key,item])=>
    ['TCP','Web','AllowFunnel','Foreground','Services'].includes(key) && empty(item)));
}
export function emptyServicesConfig(value) {
  return object(value) && value.version==='0.0.1' &&
    Object.keys(value).every(key=>['version','services'].includes(key)) &&
    (value.services===undefined || empty(value.services));
}
export function onlyDashboardRoute(value,host) {
  if (!object(value) || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(host || '')) return false;
  const expected={TCP:{443:{HTTPS:true}},Web:{[host+':443']:{Handlers:{'/':{Proxy:'http://127.0.0.1:3000'}}}}};
  const {TCP,Web,...rest}=value;
  if (!isDeepStrictEqual({TCP,Web},expected)) return false;
  return Object.entries(rest).every(([key,item])=>
    ['Foreground','Services'].includes(key)?empty(item):
      key==='AllowFunnel' && (empty(item) || isDeepStrictEqual(item,{[host+':443']:false})));
}
export function validateDashboardApproval(value,artifacts,now=Date.now()) {
  const start=Date.parse(value?.approvedAt),end=Date.parse(value?.expiresAt);
  if (!object(value) || value.version!==1 || value.issue!==1662 || value.goalIssue!==1219 ||
    value.owner!=='haji84' || value.nodeId!=='macbook' || value.platform!=='macos' ||
    value.operation!=='private-dashboard-loopback-and-tailnet-https' ||
    value.dashboardPort!==3000 || value.httpsPort!==443 || value.sourceBinding!=='current-main-successful-ci' ||
    !/^https:\/\/github\.com\/haji84\/AI-\/issues\/1662#issuecomment-\d+$/.test(value.evidence || '') ||
    !Number.isFinite(start) || !Number.isFinite(end) || start>now || end<=now || end-start>86400000 || end<=start ||
    !object(artifacts) || !Object.keys(artifacts).length ||
    !Object.values(artifacts).every(sha=>/^[a-f0-9]{40}$/.test(sha)) ||
    !isDeepStrictEqual(value.artifacts,artifacts)) throw Error('DASHBOARD_APPROVAL_REJECTED');
}
function validateSnapshot(s,{requireAbsence=true}={}) {
  if (s?.platform!=='darwin' || !Number.isInteger(s.uid) || s.uid<=0 || !/^[a-f0-9]{40}$/.test(s.revision || '') ||
    !s.exactMainCi || !s.sourceClean || !s.protectedSurfaces || !s.existingCredentialsReady || !s.existingStateReady ||
    s.androidCount!==38 || !s.releaseBuilt || !s.brokerHealthy || s.brokerRevision!==s.revision ||
    (requireAbsence && (!s.dashboardAbsent || !s.labelAbsent)) ||
    s.backendState!=='Running' || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(s.host || '') ||
    !emptyServeConfig(s.serve) || !emptyServicesConfig(s.services)) throw Error('DASHBOARD_BASELINE_REJECTED');
}
export async function executeDashboardRepair(input,ops) {
  validateDashboardApproval(input.approval,input.artifacts,input.now);
  validateSnapshot(input.snapshot);
  if (!['plan','apply'].includes(input.phase)) throw Error('DASHBOARD_PHASE_REJECTED');
  const receipt={version:1,issue:1662,goalIssue:1219,nodeId:'macbook',sourceRevision:input.snapshot.revision,
    observedAt:new Date().toISOString(),phase:input.phase,readOnly:input.phase==='plan',transportAcceptanceVerified:false};
  if (input.phase==='plan') return {...receipt,activationVerified:false,baselineVerified:true};
  let stage='backup',dashboardAttempted=false,routeAttempted=false;
  try {
    await ops.backup(input.snapshot);
    stage='boundary';
    validateDashboardApproval(input.approval,input.artifacts,ops.now?.() ?? input.now);
    const fresh=await ops.recheck();validateSnapshot(fresh);
    validateDashboardApproval(input.approval,input.artifacts,ops.now?.() ?? input.now);
    if (fresh.revision!==input.snapshot.revision || fresh.host!==input.snapshot.host) throw Error();
    stage='dashboard';dashboardAttempted=true;
    await ops.startDashboard();
    stage='dashboard-health';await ops.verifyDashboard();
    stage='route-boundary';
    validateDashboardApproval(input.approval,input.artifacts,ops.now?.() ?? input.now);
    const beforeRoute=await ops.recheck();validateSnapshot(beforeRoute,{requireAbsence:false});
    validateDashboardApproval(input.approval,input.artifacts,ops.now?.() ?? input.now);
    if (beforeRoute.revision!==input.snapshot.revision || beforeRoute.host!==input.snapshot.host) throw Error();
    stage='serve';routeAttempted=true;await ops.createRoute();
    stage='private-health';await ops.verifyRoute();
    stage='preservation';await ops.verifyPreservation();
    return {...receipt,complete:true,activationVerified:true,dashboardHealthy:true,privateHttpsConfigured:true,
      statePreserved:true,androidCount:38};
  } catch {
    let recovery={restored:false,recoveryBlocked:true};
    try { recovery=await ops.recover({dashboardAttempted,routeAttempted}); } catch {}
    return {...receipt,complete:false,activationVerified:false,failedStage:stage,
      failureReason:'MAC_PRIVATE_DASHBOARD_REPAIR_FAILED',restored:recovery.restored===true,
      recoveryBlocked:recovery.recoveryBlocked!==false,retainedExistingKeysAndState:true};
  }
}

export function stableFleetEnrollment(fleet) {
  if(!Array.isArray(fleet))throw Error('STATE_REJECTED');
  const keys=['id','kind','enrollment','fleetNumber','group','pcAuthority'];
  return fleet.map(node=>Object.fromEntries(keys.filter(key=>node[key]!==undefined).map(key=>[key,node[key]])))
    .sort((a,b)=>a.id.localeCompare(b.id));
}
// Used by the native recovery path too: inspect every ingress surface before removing its dependency.
export async function recoverDashboardSurfaces({dashboardAttempted,routeAttempted,host},ops) {
  const blocked=()=>({restored:false,recoveryBlocked:true});
  let current=await ops.serve();
  if(!emptyServicesConfig(await ops.services()))return blocked();
  if(!emptyServeConfig(current)) {
    if(!routeAttempted || !onlyDashboardRoute(current,host))return blocked();
    await ops.removeRoute();
  }
  current=await ops.serve();
  if(!emptyServeConfig(current) || !emptyServicesConfig(await ops.services()))return blocked();
  if(dashboardAttempted && await ops.dashboardWritten()) {
    if(!await ops.ownedPlist())return blocked();
    // Inspect again immediately before unloading: never break an uncertain dependent route.
    if(!emptyServeConfig(await ops.serve()) || !emptyServicesConfig(await ops.services()))return blocked();
    await ops.removeDashboard();
    if(!await ops.dashboardAbsent())return blocked();
    await ops.retainPlist();
  }
  await ops.verifyState();
  return {restored:true,recoveryBlocked:false};
}

export function validateDashboardAutomaticTrigger({revision,actor,run,pullRequest}) {
  if(actor!=='haji84' || !/^[a-f0-9]{40}$/.test(revision || '') ||
    run?.name!=='GORIQ JARVIS Production Sync' || run.event!=='workflow_run' || run.status!=='completed' || run.conclusion!=='success' ||
    run.head_branch!=='main' || run.head_sha!==revision || run.actor?.login!=='haji84' ||
    run.head_repository?.full_name!=='haji84/AI-' ||
    pullRequest?.number!==1712 || pullRequest.merged!==true || pullRequest.merge_commit_sha!==revision ||
    pullRequest.base?.ref!=='main' || pullRequest.base?.repo?.full_name!=='haji84/AI-' ||
    pullRequest.user?.login!=='haji84')throw Error('MAC_DASHBOARD_AUTOMATIC_TRIGGER_REJECTED');
}

export function dashboardFailureClass(error) {
  const allowed=new Set(['NATIVE_PATH_REJECTED','NATIVE_PARENT_REJECTED','NATIVE_ACL_REJECTED',
    'NATIVE_PARENT_ACL_REJECTED','NATIVE_SECRET_PATH_REJECTED','NATIVE_COMMAND_REJECTED',
    'OWNER_AUTH_REJECTED','COMPASS_STATE_REJECTED','SOURCE_REJECTED','BROKER_SOURCE_REJECTED',
    'STATE_REJECTED','IDENTITY_REJECTED','CONFIG_OR_STATE_CHANGED','RELEASE_PROVENANCE_REJECTED',
    'DASHBOARD_APPROVAL_REJECTED','MAC_DASHBOARD_AUTOMATIC_TRIGGER_REJECTED']);
  return error instanceof Error && allowed.has(error.message)?error.message:'MAC_PRIVATE_DASHBOARD_PREREQUISITE_REJECTED';
}
