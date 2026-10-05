import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectPrivateIngress, serviceHealthMatches } from './jarvis-remote-access-lib.mjs';

function parsed(result) {
  if (!result?.ok) return undefined;
  try { return JSON.parse(result.stdout); } catch { return undefined; }
}
function privateHost(status) {
  const host=typeof status?.Self?.DNSName==='string'?status.Self.DNSName.replace(/\.$/,''):'';
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$/i.test(host)?host:undefined;
}
export function summarizeNetwork(statusResult,serveResult) {
  const raw=parsed(statusResult);
  const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  const status=object(raw) && (raw.Peer===undefined || object(raw.Peer))?raw:undefined;
  const host=privateHost(status);
  const ingress=host?inspectPrivateIngress(serveResult?.stdout,{commandSucceeded:serveResult?.ok===true,dnsName:host}):{state:'unknown',ready:false};
  const peers=Object.values(status?.Peer || {}).filter(p=>p?.Online===true);
  const state=status?.BackendState;
  return {statusReadable:!!status && typeof status==='object',serveReadable:parsed(serveResult)!==undefined,
    backendState:['Running','Stopped','NeedsLogin','NeedsMachineAuth','Starting','NoState'].includes(state)?state:'unknown',
    selfDnsAvailable:!!host,onlinePeerCount:status?peers.length:null,
    onlineMacPeerCount:status?peers.filter(p=>['macos','darwin'].includes(String(p.OS).toLowerCase())).length:null,
    onlineWindowsPeerCount:status?peers.filter(p=>String(p.OS).toLowerCase()==='windows').length:null,
    privateHttpsConfigured:ingress.ready===true,funnelState:ingress.state,transportAcceptanceVerified:false};
}
function transportClass(error) {
  if (error?.message==='HEALTH_BODY_REJECTED') return 'invalid-response';
  if (error?.message==='HEALTH_TIMEOUT') return 'timeout';
  if (error?.name==='TimeoutError' || error?.name==='AbortError') return 'timeout';
  const code=error?.cause?.code ?? error?.code;
  if (code==='ECONNREFUSED') return 'connection-refused';
  if (['ENOTFOUND','EAI_AGAIN'].includes(code)) return 'dns';
  if (['CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)) return 'tls';
  if (['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code)) return 'timeout';
  return 'other';
}
const execute=promisify(execFile);
async function runNative(command,args) {
  try {
    const {stdout}=await execute(command,args,{encoding:'utf8',timeout:5000,maxBuffer:262144,windowsHide:true});
    return {ok:true,stdout};
  } catch { return {ok:false}; }
}
async function healthJson(response,signal) {
  if (!response.body) throw new Error('HEALTH_BODY_REJECTED');
  const reader=response.body.getReader(),parts=[];
  let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try {
    for (;;) {
      if (signal.aborted) throw new Error('HEALTH_TIMEOUT');
      const chunk=await reader.read();
      if (signal.aborted) throw new Error('HEALTH_TIMEOUT');
      if (chunk.done) break;
      size+=chunk.value.byteLength;
      if (size>65536) throw new Error('HEALTH_BODY_REJECTED');
      parts.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch(error) {cancel();throw error;}
  finally {signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
async function health(url,name,fetcher,publicRevisions) {
  const signal=AbortSignal.timeout(5000);
  try {
    const response=await fetcher(url,{method:'GET',redirect:'error',signal});
    // Only health responses are parsed, and only fixed booleans/public source hashes leave this process.
    const body=await healthJson(response,signal);
    return {attempted:true,httpStatus:response.status,healthy:serviceHealthMatches(name,response.status,body),
      runtimeRevision:name==='broker' && publicRevisions.includes(body?.runtimeRevision)?body.runtimeRevision:null};
  } catch(error) { return {attempted:true,healthy:false,transportClass:transportClass(error)}; }
}
export async function collectNetwork({platform=process.platform,revision,run=runNative,fetcher=fetch}={}) {
  if (!['darwin','win32'].includes(platform)) throw new Error('NATIVE_PC_REQUIRED');
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('SOURCE_REVISION_REQUIRED');
  const command=platform==='win32'?join(process.env.ProgramFiles || 'C:\\Program Files','Tailscale','tailscale.exe'):'tailscale';
  const [status,serve]=await Promise.all([run(command,['status','--json']),run(command,['serve','status','--json'])]);
  const network=summarizeNetwork(status,serve),host=network.statusReadable?privateHost(parsed(status)):undefined;
  // Both entries are public source commits: this exact CI-checked diagnostic and the recorded native baseline.
  const publicRevisions=[revision,'a49c458d69a28c0266be8fcad5b26253e5ed8d75'];
  const [dashboard,broker,gateway,privateHttpsHealth]=await Promise.all([
    health('http://127.0.0.1:3000/api/health','dashboard',fetcher,publicRevisions),
    health('http://127.0.0.1:8787/health','broker',fetcher,publicRevisions),
    health('http://127.0.0.1:8790/health','remote-gateway',fetcher,publicRevisions),
    host?health('https://'+host+'/api/health','dashboard',fetcher,publicRevisions):{attempted:false,healthy:false},
  ]);
  return {version:1,issue:1662,goalIssue:1219,nodeId:platform==='darwin'?'macbook':'zbook',readOnly:true,
    diagnosticOnly:true,sourceRevision:revision,observedAt:new Date().toISOString(),...network,
    dashboardHealthy:dashboard.healthy,brokerHealthy:broker.healthy,gatewayHealthy:gateway.healthy,
    brokerRevision:broker.runtimeRevision || null,brokerMatchesDiagnosticSource:broker.runtimeRevision===revision,
    loopbackHealth:{dashboard,broker,gateway},privateHttpsHealth};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  collectNetwork({revision:process.env.GITHUB_SHA}).then(result=>console.log(JSON.stringify(result))).catch(()=>{
    console.error(JSON.stringify({version:1,issue:1662,readOnly:true,diagnosticOnly:true,complete:false,
      failureReason:'PC_PRIVATE_NETWORK_DIAGNOSTIC_FAILED'}));process.exitCode=1;
  });
}
