// Existing-route observation only. Never configure SSH or repair/enrol a runner.
import { constants } from 'node:fs';
import { lstat, open, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const revisionPattern = /^[a-f0-9]{40}$/;
const positive = /^[1-9][0-9]{0,19}$/;
function trusted(platform, env) {
  return platform === 'darwin' && env.GITHUB_REPOSITORY === 'haji84/AI-' && env.GITHUB_ACTOR === 'haji84' &&
    env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.RUNNER_NAME === 'MacBook' &&
    revisionPattern.test(env.GITHUB_SHA ?? '') && positive.test(env.GITHUB_RUN_ID ?? '') && positive.test(env.GITHUB_RUN_ATTEMPT ?? '');
}
function nativeRun(command, args, options) {
  return new Promise(resolve => execFile(command, args, options, (error, stdout, stderr) => resolve({ok:!error,stdout,stderr})));
}
// Reject every unsupported directive, even outside the selected block. Never call ssh -G
// (Include/Match/Proxy directives can execute programs during configuration evaluation).
function parseConfig(text, root) {
  let current, route;
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z]+)\s+([^\s"'`#$%\\]+)$/.exec(line);
    if (!match) throw Error();
    const [, key, value] = match, directive = key.toLowerCase();
    if (directive === 'host') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || seen.has(value.toLowerCase())) throw Error();
      seen.add(value.toLowerCase()); current = {};
      if (value.toLowerCase() === 'zbook') route = current;
      continue;
    }
    if (!current || !['hostname','user','port','identityfile'].includes(directive) || Object.hasOwn(current,directive)) throw Error();
    current[directive] = value;
  }
  if (!route || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(route.hostname ?? '') ||
      !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(route.user ?? '') ||
      (route.port !== undefined && (!/^[1-9][0-9]{0,4}$/.test(route.port) || Number(route.port)>65535))) throw Error();
  let identity = route.identityfile;
  if (identity?.startsWith('~/.ssh/')) {
    const suffix=identity.slice(7);
    if (!suffix.split('/').every(part=>/^[A-Za-z0-9._-]+$/.test(part)&&part!=='.'&&part!=='..')) throw Error();
    identity=join(root,suffix);
  }
  if (!identity || !identity.startsWith(root + sep) || resolve(identity) !== identity) throw Error();
  return {...route, identity};
}
async function checkedMetadata(path, uid, directory, privateFile = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || stat.uid !== uid || (directory ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & (privateFile ? 0o077 : 0o022)) !== 0 || (privateFile && ![0o400,0o600].includes(stat.mode & 0o777))) throw Error();
  return stat;
}
async function checkedFile(path, root, uid, privateFile = false) {
  const parents=[];
  for (let parent=dirname(path); parent!==root; parent=dirname(parent)) {
    if (!parent.startsWith(root+sep)) throw Error();
    parents.push(parent);
  }
  for (const parent of parents.reverse()) await checkedMetadata(parent,uid,true);
  return checkedMetadata(path,uid,false,privateFile);
}
async function configText(path, root, uid) {
  const metadata = await checkedFile(path,root,uid);
  if (metadata.size > 65536) throw Error();
  const handle = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (current.ino!==metadata.ino || current.dev!==metadata.dev) throw Error();
    const buffer=Buffer.alloc(65537), {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if (bytesRead>65536) throw Error();
    return buffer.subarray(0,bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
// Source-fixed payload: the remote login shell receives only this reviewed constant.
const payload = `$ErrorActionPreference='Stop';if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){exit 2};$processes=@(Get-Process -ErrorAction Stop);$l=@($processes|Where-Object {$_.ProcessName -eq 'Runner.Listener'}).Count;$w=@($processes|Where-Object {$_.ProcessName -eq 'Runner.Worker'}).Count;[ordered]@{platform='windows';listenerCount=$l;workerCount=$w}|ConvertTo-Json -Compress`;
const remoteCommand = 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(payload,'utf16le').toString('base64');

export async function inspectZBookRunnerFromMac(options = {}) {
  const env=options.env ?? process.env, platform=options.platform ?? process.platform;
  const report={sourceRevision:revisionPattern.test(env.GITHUB_SHA ?? '')?env.GITHUB_SHA:null,
    runId:positive.test(env.GITHUB_RUN_ID ?? '')?env.GITHUB_RUN_ID:null,
    runAttempt:positive.test(env.GITHUB_RUN_ATTEMPT ?? '')?env.GITHUB_RUN_ATTEMPT:null,
    observedAt:new Date().toISOString(),failureClass:'context-invalid',
    prerequisites:{contextVerified:false,sshConfigReadable:false,literalRouteVerified:false,identityMetadataVerified:false,knownHostsVerified:false},
    processObservationVerified:false,listenerCount:null,workerCount:null,originalGoalRecovered:false};
  if (!trusted(platform,env)) return report;
  report.prerequisites.contextVerified=true;
  const uid=options.uid ?? process.getuid(), root=join(options.home ?? homedir(),'.ssh');
  let route, text;
  try {
    await checkedMetadata(dirname(root),uid,true);
    await checkedMetadata(root,uid,true);
    text=await configText(join(root,'config'),root,uid);
    report.prerequisites.sshConfigReadable=true;
  } catch {report.failureClass='ssh-config-unavailable';return report;}
  try {
    route=parseConfig(text,root);
    report.prerequisites.literalRouteVerified=true;
  } catch {report.failureClass='ssh-config-unsupported';return report;}
  try {
    await checkedFile(route.identity,root,uid,true);
    report.prerequisites.identityMetadataVerified=true;
  } catch {report.failureClass='identity-unavailable';return report;}
  const knownHosts=join(root,'known_hosts');
  try {
    const stat=await checkedFile(knownHosts,root,uid);
    if (stat.size===0) throw Error();
    report.prerequisites.knownHostsVerified=true;
  } catch {report.failureClass='host-pins-unavailable';return report;}
  const args=['-F','/dev/null','-n','-T'];
  for(const option of ['BatchMode=yes','StrictHostKeyChecking=yes','UpdateHostKeys=no','IdentitiesOnly=yes','IdentityAgent=none',
    'CertificateFile=none','AddKeysToAgent=no','PasswordAuthentication=no','KbdInteractiveAuthentication=no','PreferredAuthentications=publickey','NumberOfPasswordPrompts=0',
    'ForwardAgent=no','ForwardX11=no','ClearAllForwardings=yes','PermitLocalCommand=no','ProxyCommand=none','ProxyJump=none',
    'ControlMaster=no','ControlPath=none','ControlPersist=no','ConnectionAttempts=1','ConnectTimeout=5',
    'GlobalKnownHostsFile=/dev/null','UserKnownHostsFile='+knownHosts,'LogLevel=ERROR']) args.push('-o',option);
  args.push('-i',route.identity,'-p',route.port ?? '22','-l',route.user,'--',route.hostname,remoteCommand);
  report.failureClass='ssh-observation-unavailable';
  try {
    const result=await (options.run ?? nativeRun)('/usr/bin/ssh',args,{timeout:20000,maxBuffer:8192,encoding:'utf8',shell:false,env:{PATH:'/usr/bin:/bin',LANG:'C'}});
    if (!result?.ok || typeof result.stdout!=='string' || Buffer.byteLength(result.stdout)>8192 || (result.stderr ?? '')!=='') return report;
    if (result.stdout.includes('\\')) return report;
    if ((result.stdout.match(/"(?:platform|listenerCount|workerCount)"\s*:/g) ?? []).length!==3) return report;
    const data=JSON.parse(result.stdout);
    if (!data || Array.isArray(data) || Object.keys(data).sort().join(',')!=='listenerCount,platform,workerCount' || data.platform!=='windows' ||
        ![data.listenerCount,data.workerCount].every(n=>Number.isInteger(n)&&n>=0&&n<=64)) return report;
    report.listenerCount=data.listenerCount;report.workerCount=data.workerCount;
    report.processObservationVerified=true;report.failureClass=null;
  } catch { /* Native exceptions may contain identities, addresses or credentials. */ }
  return report;
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length!==2 || !trusted(process.platform,process.env)) throw Error();
    // The source is fresh per run/attempt. Refuse any retained result directory.
    await mkdir('.gai-results',{mode:0o700});
    const report=await inspectZBookRunnerFromMac();
    await writeFile('.gai-results/zbook-runner-readonly.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(report));
  } catch {console.error('ZBOOK_RUNNER_READONLY_REFUSED');process.exitCode=1;}
}
