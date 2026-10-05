import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createHash, createPublicKey } from 'node:crypto';
import { lstat, readFile, writeFile, mkdir, rename, realpath, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, isAbsolute, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
let stage='context';
const mark=value=>{stage=value;console.log('MAC_DASHBOARD_STAGE='+stage);};
import { emptyServeConfig, emptyServicesConfig, onlyDashboardRoute, validateDashboardApproval,
  executeDashboardRepair, stableFleetEnrollment, recoverDashboardSurfaces, validateDashboardAutomaticTrigger, dashboardFailureClass } from './goriq-mac-private-dashboard.mjs';

const execute=promisify(execFile);
const label='com.aicompany.jarvis-private-dashboard';
const artifactPaths=['scripts/goriq-mac-private-dashboard.mjs','scripts/goriq-mac-private-dashboard-native.mjs',
  'scripts/goriq-mac-private-dashboard-entry.sh','.github/workflows/goriq-mac-private-dashboard.yml'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const blob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
async function run(command,args,{timeout=10000,env=process.env,cwd=process.cwd(),allowAbsent=false}={}) {
  try {return (await execute(command,args,{timeout,maxBuffer:4*1024*1024,encoding:'utf8',env,cwd,stdio:['ignore','pipe','pipe']})).stdout;}
  catch(error) {
    if (allowAbsent && error.code===1 && !String(error.stderr || '').trim() && !String(error.stdout || '').trim()) return '';
    throw Error('NATIVE_COMMAND_REJECTED');
  }
}
export async function pathGuard(path,{secret=false,allowAbsent=false}={}) {
  if (!isAbsolute(path)) throw Error('NATIVE_PATH_REJECTED');
  let item,privateAncestor=false;
  try {item=await lstat(path);} catch(error) {
    if (!(allowAbsent && error.code==='ENOENT')) throw Error('NATIVE_PATH_REJECTED');
  }
  if (item && (item.isSymbolicLink() || item.uid!==process.getuid() || (item.mode&0o022))) throw Error('NATIVE_PATH_REJECTED');
  for(let parent=dirname(path);;parent=dirname(parent)) {
    const entry=await lstat(parent);
    if (!entry.isDirectory() || entry.isSymbolicLink() || ![0,process.getuid()].includes(entry.uid) || (entry.mode&0o022)) throw Error('NATIVE_PARENT_REJECTED');
    if(entry.uid===process.getuid() && !(entry.mode&0o077))privateAncestor=true;
    if(process.platform==='darwin' && /^\s*\d+: .+\ballow\b/m.test(await run('/bin/ls',['-lde',parent])))throw Error('NATIVE_PARENT_ACL_REJECTED');
    if (parent==='/') break;
  }
  if(process.platform==='darwin' && item && /^\s*\d+: .+\ballow\b/m.test(await run('/bin/ls',['-lde',path])))throw Error('NATIVE_ACL_REJECTED');
  if(secret && item && (item.mode&0o077) && !privateAncestor)throw Error('NATIVE_SECRET_PATH_REJECTED');
  return item;
}

export async function protectedOwnerPathFacts(path) {
  const facts=[];let current=path,index=0;
  for(;;) {
    try {
      const item=await lstat(current);
      const acl=process.platform==='darwin'?await run('/bin/ls',['-lde',current]):'';
      facts.push({surface:index===0?'environment':'parent-'+index,exists:true,symlink:item.isSymbolicLink(),
        ownerClass:item.uid===process.getuid()?'current-user':item.uid===0?'system':'other',
        directory:item.isDirectory(),groupWritable:!!(item.mode&0o020),worldWritable:!!(item.mode&0o002),
        privateMode:!(item.mode&0o077),additionalAllowPresent:/^\s*\d+: .+\ballow\b/m.test(acl)});
    }catch{facts.push({surface:index===0?'environment':'parent-'+index,queryAvailable:false});}
    if(current==='/')break;current=dirname(current);index++;
  }
  return facts;
}

async function ownerDirectory(path) {
  const parent=dirname(path);
  try {await lstat(parent);} catch(error) {if(error.code!=='ENOENT')throw error;await ownerDirectory(parent);}
  await pathGuard(path,{allowAbsent:true});
  await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await pathGuard(path,{secret:true});
}
export function parseDashboardListeners(output) {
  const lines=String(output).trim().split('\n').filter(Boolean),rows=[];
  let pid;
  for(const line of lines) {
    if (/^p\d+$/.test(line)) pid=Number(line.slice(1));
    else if(/^f\d+[a-z]*$/.test(line)) {if(!pid)throw Error('LISTENER_QUERY_REJECTED');}
    else if(line.startsWith('n')) {
      if (!pid) throw Error('LISTENER_QUERY_REJECTED');
      rows.push({pid,loopback:line.slice(1)==='127.0.0.1:3000'});
    } else throw Error('LISTENER_QUERY_REJECTED');
  }
  return rows;
}
const escapeXml=value=>String(value).replace(/[<>&'"]/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[char]));
export function dashboardPlist({release,node,revision,dbPath,home}) {
  if (![release,node,dbPath,home].every(isAbsolute) || !/^[a-f0-9]{40}$/.test(revision)) throw Error('DASHBOARD_PLIST_REJECTED');
  const values=['/bin/bash',join(release,'scripts/goriq-mac-private-dashboard-entry.sh'),node,release,revision,dbPath,home];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
    '<plist version="1.0"><dict><key>Label</key><string>'+label+'</string><key>ProgramArguments</key><array>'+
    values.map(value=>'<string>'+escapeXml(value)+'</string>').join('')+
    '</array><key>WorkingDirectory</key><string>'+escapeXml(release)+'</string>'+
    '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>'+
    '<key>StandardOutPath</key><string>'+escapeXml(join(release,'dashboard.out.log'))+'</string>'+
    '<key>StandardErrorPath</key><string>'+escapeXml(join(release,'dashboard.err.log'))+'</string></dict></plist>\n';
}
async function health(url) {
  const signal=AbortSignal.timeout(5000),response=await fetch(url,{signal,redirect:'error'});
  const reader=response.body?.getReader(),parts=[];let size=0;
  if(!reader)throw Error('HEALTH_REJECTED');
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try {
    for(;;) {
      if(signal.aborted)throw Error('HEALTH_REJECTED');
      const chunk=await reader.read();
      if(signal.aborted)throw Error('HEALTH_REJECTED');
      if(chunk.done)break;
      size+=chunk.value.byteLength;if(size>65536)throw Error('HEALTH_REJECTED');parts.push(chunk.value);
    }
    if(response.status!==200)throw Error('HEALTH_REJECTED');
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch(error){cancel();throw error;}
  finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}

async function fileDigest(path) {
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(path))digest.update(chunk);
  return digest.digest('hex');
}
const mutableReleasePath=path=>path==='.next/cache' || path.startsWith('.next/cache/') ||
  ['release-manifest.json','dashboard.out.log','dashboard.err.log'].includes(path);
export async function releaseInventory(root) {
  await pathGuard(root,{secret:true});
  if(process.platform==='darwin' && await run('/usr/bin/find',['-P',root,'-acl','-print0'],{timeout:60000}))throw Error('RELEASE_ACL_REJECTED');
  const result=[];
  const walk=async(directory)=>{
    for(const name of (await readdir(directory)).sort()) {
      const path=join(directory,name),key=relative(root,path),item=await lstat(path);
      if(item.uid!==process.getuid() || (!item.isSymbolicLink() && (item.mode&0o022)))throw Error('RELEASE_OWNER_REJECTED');
      if(item.isSymbolicLink()) {
        const target=await realpath(path),inside=relative(root,target);
        if(!inside || inside.startsWith('..'+sep) || inside==='..' || isAbsolute(inside))throw Error('RELEASE_LINK_REJECTED');
        if(mutableReleasePath(key))throw Error('RELEASE_MUTABLE_LINK_REJECTED');
        result.push({path:key,type:'link',target:inside});continue;
      }
      if(!item.isFile() && !item.isDirectory())throw Error('RELEASE_ITEM_REJECTED');
      if(mutableReleasePath(key))continue;
      result.push({path:key,type:item.isDirectory()?'directory':'file',mode:item.mode&0o777,
        ...(item.isFile()?{sha256:await fileDigest(path)}:{})});
      if(item.isDirectory())await walk(path);
    }
  };
  await walk(root);return result;
}
export async function verifyNodeExecutable(node) {
  if(!isAbsolute(node) || await realpath(node)!==node)throw Error('RELEASE_NODE_REJECTED');
  const item=await lstat(node);
  if(!item.isFile() || ![0,process.getuid()].includes(item.uid) || item.mode&0o022)throw Error('RELEASE_NODE_REJECTED');
  for(let path=dirname(node);;path=dirname(path)) {
    const parent=await lstat(path);
    if(!parent.isDirectory() || parent.isSymbolicLink() || ![0,process.getuid()].includes(parent.uid) || parent.mode&0o022)throw Error('RELEASE_NODE_PARENT_REJECTED');
    if(process.platform==='darwin' && /^\s*\d+: .+\ballow\b/m.test(await run('/bin/ls',['-lde',path])))throw Error('RELEASE_NODE_ACL_REJECTED');
    if(path==='/')break;
  }
}
export async function verifyDashboardRelease({release,revision,seal,node,artifacts}) {
  await verifyNodeExecutable(node);
  await pathGuard(release,{secret:true});await pathGuard(seal,{secret:true});
  const manifestPath=join(release,'release-manifest.json');await pathGuard(manifestPath,{secret:true});
  const encoded=await readFile(manifestPath,'utf8'),stamp=JSON.parse(await readFile(seal,'utf8')),built=JSON.parse(encoded);
  if(stamp.version!==1 || stamp.revision!==revision || stamp.manifestSha256!==hash(encoded) ||
    built.version!==1 || built.revision!==revision || !isDeepStrictEqual(built.artifacts,artifacts || stamp.artifacts) ||
    built.node?.path!==node || built.node.sha256!==await fileDigest(node) ||
    !isDeepStrictEqual(built.inventory,await releaseInventory(release)))throw Error('RELEASE_PROVENANCE_REJECTED');
  for(const path of artifactPaths) {
    if(blob(await readFile(join(release,path),'utf8'))!==built.artifacts[path])throw Error('RELEASE_ARTIFACT_REJECTED');
  }
  return built;
}
export async function reuseStagedRelease(options) {
  try {await verifyDashboardRelease(options);return true;}catch{return false;}
}

async function main(phase) {
  process.umask(0o077);
  if(process.platform!=='darwin' || !process.getuid() || !['prepare','plan','apply'].includes(phase))throw Error('NATIVE_CONTEXT_REJECTED');
  mark('source');const revision=process.env.GITHUB_SHA;
  const verifySource=async()=>{
    if(process.env.GITHUB_REPOSITORY!=='haji84/AI-' || process.env.GITHUB_REF!=='refs/heads/main' ||
      process.env.GITHUB_ACTOR!=='haji84' || !/^[a-f0-9]{40}$/.test(revision || '') ||
      (await run('git',['rev-parse','HEAD'])).trim()!==revision ||
      (await run('git',['status','--porcelain','--untracked-files=no'])).trim())throw Error('SOURCE_REJECTED');
    await run(process.execPath,['scripts/goriq-pc-approved-source.mjs'],{env:{...process.env,GORIQ_PC_APPROVED_REVISION:revision},timeout:45000});
  };
  await verifySource();
  if(process.env.GITHUB_EVENT_NAME==='workflow_run') {
    const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
    const response=await fetch('https://api.github.com/repos/haji84/AI-/pulls/1712',{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('MAC_DASHBOARD_TRIGGER_PROOF_UNAVAILABLE');
    validateDashboardAutomaticTrigger({revision,actor:process.env.GITHUB_ACTOR,run:event.workflow_run,pullRequest:await response.json()});
  } else if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw Error('MAC_DASHBOARD_EVENT_REJECTED');
  await verifyNodeExecutable(process.execPath);
  mark('approval');const artifacts=Object.fromEntries(await Promise.all(artifactPaths.map(async path=>[path,blob(await readFile(path,'utf8'))])));
  const approval=JSON.parse(await readFile('docs/authorizations/1662-mac-private-dashboard.json','utf8'));
  validateDashboardApproval(approval,artifacts);
  const home=homedir(),base=join(home,'.goriq','private-dashboard'),release=join(base,'releases',revision);
  const envPath=join(home,'Library','Application Support','JARVIS','jarvis.env');
  mark('owner-environment');
  try{await pathGuard(envPath,{secret:true});}catch(error){
    console.log('MAC_ENVIRONMENT_BOUNDARY='+JSON.stringify({version:1,issue:1662,readOnly:true,
      surfaces:await protectedOwnerPathFacts(envPath)}));throw error;
  }
  const fields=['JARVIS_OWNER_TOKEN','JARVIS_OWNER_SECRET','AI_COMPANY_OWNER_SECRET','JARVIS_REMOTE_GATEWAY_TOKEN',
    'JARVIS_REMOTE_ALLOWED_SERIALS','JARVIS_DB_PATH','GORIQ_STATE_ROOT','JARVIS_COMPASS_DB_PATH','JARVIS_WORKER_APK_PATH'];
  // Existing trusted owner file is sourced only inside an owner-local child. Output is captured, never logged.
  const command='set -e; readonly _goriqNode="$2"; set -a; source "$1" >/dev/null; set +a; unset NODE_OPTIONS; exec "$_goriqNode" -e "$3"';
  const config=JSON.parse(await run('/bin/bash',['-c',command,'goriq',envPath,process.execPath,
    'console.log(JSON.stringify(Object.fromEntries('+JSON.stringify(fields)+'.map(k=>[k,process.env[k]||""]))))']));
  if(!config.JARVIS_OWNER_TOKEN?.trim() || !(config.JARVIS_OWNER_SECRET?.trim() || config.AI_COMPANY_OWNER_SECRET?.trim()))throw Error('OWNER_AUTH_REJECTED');
  const dbPath=config.JARVIS_DB_PATH || join(config.GORIQ_STATE_ROOT || join(home,'.goriq','state'),'jarvis.db');
  await pathGuard(dbPath,{secret:true});
  const compassPath=config.JARVIS_COMPASS_DB_PATH || join(config.GORIQ_STATE_ROOT || join(home,'.goriq','state'),'compass.db');
  await pathGuard(compassPath,{secret:true});
  if(!(await lstat(compassPath)).isFile())throw Error('COMPASS_STATE_REJECTED');
  const identityPath=join(home,'.goriq','state','pc-node','macbook','identity.json');
  await pathGuard(identityPath,{secret:true});
  const identity=JSON.parse(await readFile(identityPath,'utf8'));
  const hardware=(await run('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'])).match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]{36})"/)?.[1];
  if (!hardware || identity.version!==1 || identity.algorithm!=='ed25519' || identity.nodeId!=='macbook' || identity.platform!=='macos' ||
    createPublicKey(identity.privateKeyPem).asymmetricKeyType!=='ed25519' ||
    identity.hostBinding!==hash(hardware.toLowerCase()) ||
    createPublicKey(identity.privateKeyPem).export({type:'spki',format:'pem'})!==identity.publicKeyPem)throw Error('IDENTITY_REJECTED');
  const {DatabaseSync}=await import('node:sqlite');
  const stateSnapshot=()=>{
    const db=new DatabaseSync(dbPath,{readOnly:true,timeout:5000});
    try {
      const row=db.prepare('SELECT payload FROM jarvis_state WHERE id=1').get();
      const fleet=JSON.parse(row.payload).fleet,android=fleet.filter(n=>n.kind==='android');
      const identities=db.prepare('SELECT node_id,payload FROM jarvis_worker_identity ORDER BY node_id').all();
      const registered=JSON.parse(identities.find(row=>row.node_id==='macbook').payload);
      const own=fleet.find(node=>node.id==='macbook');
      if(android.length!==38 || registered.revokedAt || registered.publicKeyPem!==identity.publicKeyPem ||
        own?.kind!=='macos' || !own?.pcAuthority?.roles?.includes('Coordinator') || own.pcAuthority.approvalIssue!==1662 || own.pcAuthority.goalIssue!==1219)throw Error('STATE_REJECTED');
      return {android:stableFleetEnrollment(android),fleet:stableFleetEnrollment(fleet),identities,schema:db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()};
    } finally{db.close();}
  };
  mark('state');const beforeState=stateSnapshot(),initialEnvDigest=hash(await readFile(envPath)),initialIdentityDigest=hash(await readFile(identityPath));
  const broker=await health('http://127.0.0.1:8787/health');
  if(broker.ok!==true || broker.service!=='jarvis-broker' || broker.runtimeRevision!==revision)throw Error('BROKER_SOURCE_REJECTED');
  mark('private-network');const tailscale=(await run('/usr/bin/which',['tailscale'])).trim();
  if(!isAbsolute(tailscale))throw Error('PRIVATE_CLI_REJECTED');
  const cli=await realpath(tailscale),cliStat=await lstat(cli);
  if(!cliStat.isFile() || ![0,process.getuid()].includes(cliStat.uid) || (cliStat.mode&0o022))throw Error('PRIVATE_CLI_REJECTED');
  const serve=async()=>JSON.parse(await run(cli,['serve','status','--json']));
  const services=async()=>JSON.parse(await run(cli,['serve','get-config','--all']));
  const listeners=async()=>parseDashboardListeners(await run('/usr/sbin/lsof',['-nP','-iTCP:3000','-sTCP:LISTEN','-Fpn'],{allowAbsent:true}));
  const plist=join(home,'Library','LaunchAgents',label+'.plist'),target='gui/'+process.getuid()+'/'+label;
  await pathGuard(plist,{allowAbsent:true});
  const loaded=async()=>{
    try{await execute('/bin/launchctl',['print',target],{encoding:'utf8',timeout:10000,maxBuffer:262144});return true;}
    catch(error){if(error.code===113 && /Could not find service/.test(String(error.stderr || '')))return false;throw Error('LAUNCHD_QUERY_REJECTED');}
  };
  const seal=join(base,'release-'+revision+'.seal.json');
  const releaseOptions={release,revision,seal,node:process.execPath,artifacts};
  const verifyProtectedState=async()=>{
    await pathGuard(envPath,{secret:true});await pathGuard(dbPath,{secret:true});await pathGuard(identityPath,{secret:true});
    await pathGuard(compassPath,{secret:true});
    if(hash(await readFile(envPath))!==initialEnvDigest || hash(await readFile(identityPath))!==initialIdentityDigest ||
      !isDeepStrictEqual(beforeState,stateSnapshot()))throw Error('CONFIG_OR_STATE_CHANGED');
  };
  const snapshot=async()=>{
    await verifySource();await verifyProtectedState();await verifyDashboardRelease(releaseOptions);
    await pathGuard(envPath,{secret:true});await pathGuard(dbPath,{secret:true});await pathGuard(identityPath,{secret:true});await pathGuard(release,{secret:true});
    if(hash(await readFile(envPath))!==initialEnvDigest || hash(await readFile(identityPath))!==initialIdentityDigest)throw Error('CONFIG_CHANGED');
    const status=JSON.parse(await run(cli,['status','--json'])),dns=status.Self?.DNSName?.replace(/\.$/,'');
    const current=await health('http://127.0.0.1:8787/health');
    return {platform:process.platform,uid:process.getuid(),revision,exactMainCi:true,sourceClean:true,
      protectedSurfaces:true,existingCredentialsReady:true,existingStateReady:true,androidCount:stateSnapshot().android.length,
      releaseBuilt:true,
      brokerHealthy:current.ok===true && current.service==='jarvis-broker',brokerRevision:current.runtimeRevision,
      dashboardAbsent:(await listeners()).length===0,labelAbsent:!await loaded() && !await lstat(plist).catch(()=>null),
      host:dns,backendState:status.BackendState,serve:await serve(),services:await services()};
  };
  const verifyExistingActivation=async()=>{
    if(!await loaded() || !await lstat(plist).catch(()=>null))return false;
    await pathGuard(plist,{secret:true});await verifySource();await verifyProtectedState();
    await verifyDashboardRelease(releaseOptions);
    const expected=dashboardPlist({release,node:process.execPath,revision,dbPath,home});
    if(await readFile(plist,'utf8')!==expected)throw Error('EXISTING_LABEL_REJECTED');
    const status=JSON.parse(await run(cli,['status','--json'])),host=status.Self?.DNSName?.replace(/\.$/,'');
    const output=await run('/bin/launchctl',['print',target]),pid=Number(output.match(/\bpid = (\d+)/)?.[1]);
    const rows=await listeners();
    if(status.BackendState!=='Running' || !pid || !rows.length || !rows.every(row=>row.pid===pid && row.loopback) ||
      !onlyDashboardRoute(await serve(),host) || !emptyServicesConfig(await services()) ||
      (await health('http://127.0.0.1:3000/api/health')).status!=='ok' ||
      (await health('https://'+host+'/api/health')).status!=='ok')throw Error('EXISTING_ACTIVATION_REJECTED');
    const current=await health('http://127.0.0.1:8787/health');
    if(current.ok!==true || current.runtimeRevision!==revision)throw Error('BROKER_SOURCE_REJECTED');
    return true;
  };
  if(await verifyExistingActivation()) {
    console.log(JSON.stringify({version:1,issue:1662,nodeId:'macbook',phase,sourceRevision:revision,
      readOnly:true,complete:true,alreadyActive:true,activationVerified:true,statePreserved:true,
      transportAcceptanceVerified:false,observedAt:new Date().toISOString()}));return;
  }
  if(phase==='prepare') {
    const status=JSON.parse(await run(cli,['status','--json']));
    if(status.BackendState!=='Running' || !emptyServeConfig(await serve()) || !emptyServicesConfig(await services()) ||
      await loaded() || (await listeners()).length || await lstat(plist).catch(()=>null))throw Error('PREPARE_BOUNDARY_REJECTED');
    mark('staging');validateDashboardApproval(approval,artifacts);await ownerDirectory(base);await ownerDirectory(join(base,'releases'));
    await verifySource();await verifyProtectedState();validateDashboardApproval(approval,artifacts);
    if(await reuseStagedRelease(releaseOptions)) {
      console.log(JSON.stringify({version:1,issue:1662,nodeId:'macbook',phase:'prepare',sourceRevision:revision,
        stagingOnly:true,reusedVerifiedRelease:true,buildVerified:true,activeServicesUnchanged:true}));return;
    }
    const archive=join(base,'source-'+revision+'.tar');
    const interrupted=[release,archive,seal].filter(Boolean);
    let quarantine;
    for(const path of interrupted) {
      const existing=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(!existing)continue;
      await pathGuard(path,{secret:true});validateDashboardApproval(approval,artifacts);
      if(!quarantine){quarantine=join(base,'interrupted-'+revision+'-'+Date.now());await ownerDirectory(quarantine);}
      await rename(path,join(quarantine,path===release?'release':path===archive?'source.tar':'release.seal.json'));
    }
    validateDashboardApproval(approval,artifacts);await ownerDirectory(release);
    await run('git',['archive','--format=tar','--output='+archive,revision]);
    await run('/usr/bin/tar',['-xf',archive,'-C',release]);
    const buildEnv={PATH:process.env.PATH,HOME:home,CI:'true',NEXT_TELEMETRY_DISABLED:'1',NO_COLOR:'1'};
    if((await run('pnpm',['--version'],{env:buildEnv})).trim()!=='11.19.0' || process.version!=='v24.19.0')throw Error('BUILD_TOOLCHAIN_REJECTED');
    mark('dependencies');await run('pnpm',['install','--frozen-lockfile'],{cwd:release,env:buildEnv,timeout:300000});
    mark('build');await run('pnpm',['build'],{cwd:release,env:buildEnv,timeout:600000});
    await verifySource();await verifyProtectedState();validateDashboardApproval(approval,artifacts);
    const buildId=hash(await readFile(join(release,'.next','BUILD_ID')));
    const encoded=JSON.stringify({version:1,revision,buildId,artifacts,inventory:await releaseInventory(release),
      node:{path:process.execPath,sha256:await fileDigest(process.execPath)}});
    validateDashboardApproval(approval,artifacts);
    await writeFile(join(release,'release-manifest.json'),encoded,{flag:'wx',mode:0o600});
    await writeFile(seal,JSON.stringify({version:1,revision,artifacts,manifestSha256:hash(encoded)}),{flag:'wx',mode:0o600});
    await verifyDashboardRelease(releaseOptions);
    console.log(JSON.stringify({version:1,issue:1662,nodeId:'macbook',phase:'prepare',sourceRevision:revision,
      stagingOnly:true,activeServicesUnchanged:true,buildVerified:true,observedAt:new Date().toISOString()}));return;
  }
  await pathGuard(release,{secret:true});
  mark('baseline');const initial=await snapshot();
  let backupDir,managedText,dashboardWritten=false;
  const ownedPlist=async()=>dashboardWritten && await readFile(plist,'utf8').catch(()=>null)===managedText;
  const verifyState=async()=>{
    await verifyProtectedState();
    const current=await health('http://127.0.0.1:8787/health');
    if(current.ok!==true || current.runtimeRevision!==revision)throw Error('PRESERVATION_REJECTED');
  };
  const result=await executeDashboardRepair({phase,snapshot:initial,approval,artifacts,now:Date.now()},{
    now:Date.now,recheck:snapshot,
    backup:async()=>{
      backupDir=join(base,'recovery-'+revision+'-'+Date.now());await ownerDirectory(backupDir);
      await writeFile(join(backupDir,'baseline.json'),JSON.stringify({initial,beforeState,envDigest:hash(await readFile(envPath)),
        identityDigest:hash(await readFile(identityPath)),plistAbsent:true}),{flag:'wx',mode:0o600});
    },
    startDashboard:async()=>{
      await verifySource();await verifyProtectedState();await verifyDashboardRelease(releaseOptions);
      validateDashboardApproval(approval,artifacts);
      await pathGuard(plist,{allowAbsent:true});
      if(await loaded() || await lstat(plist).catch(()=>null) || (await listeners()).length)throw Error('DASHBOARD_CONFLICT');
      managedText=dashboardPlist({release,node:process.execPath,revision,dbPath,home});
      validateDashboardApproval(approval,artifacts);
      dashboardWritten=true;
      await writeFile(plist,managedText,{flag:'wx',mode:0o600});
      for(const name of ['dashboard.out.log','dashboard.err.log']) {
        const path=join(release,name);await pathGuard(path,{secret:true,allowAbsent:true});
        try{await writeFile(path,'',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
      }
      validateDashboardApproval(approval,artifacts);
      await run('/bin/launchctl',['bootstrap','gui/'+process.getuid(),plist]);
    },
    verifyDashboard:async()=>{
      let ready=false;
      for(let attempt=0;attempt<15;attempt++) {
        try {
          const output=await run('/bin/launchctl',['print',target]),pid=Number(output.match(/\bpid = (\d+)/)?.[1]);
          const rows=await listeners(),body=await health('http://127.0.0.1:3000/api/health');
          if(pid && rows.length && rows.every(row=>row.loopback && row.pid===pid) && body.status==='ok'){ready=true;break;}
        } catch {}
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
      if(!ready)throw Error('DASHBOARD_HEALTH_REJECTED');await verifyState();
    },
    createRoute:async()=>{validateDashboardApproval(approval,artifacts);await run(cli,['serve','--bg','--yes','--https=443','http://127.0.0.1:3000'],{timeout:30000});},
    verifyRoute:async()=>{
      if(!onlyDashboardRoute(await serve(),initial.host) || !emptyServicesConfig(await services()) ||
        (await health('https://'+initial.host+'/api/health')).status!=='ok')throw Error('PRIVATE_ROUTE_REJECTED');
    },
    verifyPreservation:verifyState,
    recover:async(state)=>recoverDashboardSurfaces({...state,host:initial.host},{
      serve,services,dashboardWritten:async()=>dashboardWritten,ownedPlist,
      removeRoute:async()=>{await run(cli,['serve','--bg','--yes','--https=443','http://127.0.0.1:3000','off'],{timeout:30000});},
      removeDashboard:async()=>{if(await loaded())await run('/bin/launchctl',['bootout','gui/'+process.getuid(),plist]);},
      dashboardAbsent:async()=>!await loaded() && (await listeners()).length===0,
      retainPlist:async()=>{await rename(plist,join(backupDir,'failed-dashboard.plist'));},
      verifyState
    })
  });
  if(backupDir)await writeFile(join(backupDir,'receipt.json'),JSON.stringify(result),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result));if(result.complete===false)process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const operation=process.argv[2]==='verify-release'?
    verifyDashboardRelease({release:process.argv[3],revision:process.argv[4],seal:process.argv[5],node:process.execPath}):
    main(process.argv[2]);
  operation.catch(error=>{console.error(JSON.stringify({version:1,issue:1662,nodeId:'macbook',
    phase:process.argv[2],failedStage:stage,complete:false,failureReason:dashboardFailureClass(error),
    retainedExistingKeysAndState:true}));process.exitCode=1;});
}
