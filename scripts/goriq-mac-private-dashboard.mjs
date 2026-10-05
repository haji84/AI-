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
    if (fresh.revision!==input.snapshot.revision || fresh.host!==input.snapshot.host) throw Error();
    stage='dashboard';dashboardAttempted=true;
    await ops.startDashboard();
    stage='dashboard-health';await ops.verifyDashboard();
    stage='route-boundary';
    validateDashboardApproval(input.approval,input.artifacts,ops.now?.() ?? input.now);
    const beforeRoute=await ops.recheck();validateSnapshot(beforeRoute,{requireAbsence:false});
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
