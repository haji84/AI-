import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';

async function inspector() {
  const module = await import('../scripts/goriq-zbook-runner-readonly.mjs').catch(() => null);
  assert.equal(typeof module?.inspectZBookRunnerFromMac, 'function', 'fixed read-only inspector must exist');
  return module.inspectZBookRunnerFromMac;
}
const context = { GITHUB_REPOSITORY:'haji84/AI-', GITHUB_ACTOR:'haji84', GITHUB_REF:'refs/heads/main',
  GITHUB_EVENT_NAME:'workflow_dispatch', RUNNER_NAME:'MacBook', GITHUB_SHA:'a'.repeat(40),
  GITHUB_RUN_ID:'42', GITHUB_RUN_ATTEMPT:'2' };
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(),'zbook-inspector-'));
  t.after(() => rm(home,{recursive:true,force:true}));
  const root = join(home,'.ssh'); await mkdir(root,{mode:0o700});
  const key = join(root,'PRIVATE_KEY_CANARY');
  await writeFile(key,'PRIVATE_KEY_BYTES_CANARY',{mode:0o600});
  await writeFile(join(root,'known_hosts'),'PRIVATE_HOST_PIN_CANARY',{mode:0o600});
  const config = `Host zbook\n HostName private-host-canary.example\n User private-user-canary\n Port 2222\n IdentityFile ${key}\n`;
  await writeFile(join(root,'config'),config,{mode:0o600});
  const calls=[];
  return {home,root,key,config,calls, options:{platform:'darwin',env:context,home,uid:process.getuid(),
    run:async(...args)=>{calls.push(args);return {ok:true,stdout:'{"platform":"windows","listenerCount":1,"workerCount":0}',stderr:''};}}};
}
function unknown(report) {
  assert.equal(report.processObservationVerified,false);
  assert.equal(report.listenerCount,null); assert.equal(report.workerCount,null);
  assert.equal(report.originalGoalRecovered,false);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE|private-|zbook-inspector|\.ssh|EncodedCommand|Get-Process/);
}

test('untrusted workflow/native context refuses before file or command work',async()=>{
  const inspect=await inspector();
  for(const overrides of [{platform:'linux'},...Object.keys(context).map(k=>({env:{...context,[k]:'untrusted'}}))]) {
    let calls=0;
    const report=await inspect({platform:'darwin',env:context,get home(){calls++;throw Error('PRIVATE');},run:async()=>{calls++;},...overrides});
    unknown(report); assert.equal(report.failureClass,'context-invalid'); assert.equal(calls,0);
  }
});
test('missing local config returns unavailable, never a zero process observation',async t=>{
  const f=await fixture(t); await rm(join(f.root,'config'));
  const report=await (await inspector())(f.options); unknown(report);
  assert.equal(report.failureClass,'ssh-config-unavailable'); assert.equal(f.calls.length,0);
});
test('literal existing route permits one fixed strict-auth read and exports counts only',async t=>{
  const f=await fixture(t),report=await (await inspector())(f.options);
  assert.equal(report.processObservationVerified,true); assert.equal(report.listenerCount,1); assert.equal(report.workerCount,0);
  assert.equal(report.originalGoalRecovered,false); assert.equal(f.calls.length,1);
  const [command,args,options]=f.calls[0]; assert.equal(command,'/usr/bin/ssh');
  for(const token of ['BatchMode=yes','StrictHostKeyChecking=yes','UpdateHostKeys=no','IdentitiesOnly=yes','IdentityAgent=none',
    'PasswordAuthentication=no','KbdInteractiveAuthentication=no','ForwardAgent=no','ClearAllForwardings=yes','PermitLocalCommand=no',
    'ControlMaster=no','ControlPath=none','ControlPersist=no','ConnectionAttempts=1','ConnectTimeout=5','GlobalKnownHostsFile=/dev/null']) assert.ok(args.includes(token),token);
  assert.deepEqual(args.slice(0,2),['-F','/dev/null']); assert.ok(!args.some(arg=>arg.startsWith('HostKeyAlias=')));
  assert.ok(args.includes('UserKnownHostsFile='+join(f.root,'known_hosts')));
  assert.ok(args.includes(f.key)); assert.ok(args.includes('private-host-canary.example'));
  const remote=args.at(-1); assert.match(remote,/^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
  const payload=Buffer.from(remote.split(' ').at(-1),'base64').toString('utf16le');
  assert.match(payload,/Win32NT/); assert.match(payload,/Get-Process -ErrorAction Stop/); assert.equal((payload.match(/Get-Process/g)||[]).length,1); assert.doesNotMatch(payload,/SilentlyContinue/); assert.match(payload,/Runner.Listener/); assert.match(payload,/Runner.Worker/);
  assert.doesNotMatch(payload,/Start-|Stop-|Set-|ExecutionPolicy|Invoke-|PRIVATE|private-/);
  assert.equal(options.timeout,20000); assert.equal(options.maxBuffer,8192); assert.equal(options.shell,false);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE|private-|zbook-inspector|\.ssh/);
});
test('unsupported or ambiguous SSH configuration cannot execute configuration commands',async t=>{
  const f=await fixture(t),inspect=await inspector();
  for(const config of ['Include other','Match exec canary',f.config+' ProxyCommand canary\n',f.config+' ProxyJump other\n',
    f.config+' LocalCommand canary\n',f.config+' HostName duplicate\n',f.config+'Host zbook\n',f.config.replace('Host zbook','Host *'),
    f.config.replace(f.key,'${HOME}/key'),f.config.replace(f.key,'~/.ssh/key'),f.config.replace('private-host-canary.example','%h'),
    f.config.replace('2222','0'),f.config.replace('private-user-canary','user;canary'),f.config+'x'.repeat(65536)]) {
    await writeFile(join(f.root,'config'),config); const report=await inspect(f.options); unknown(report); assert.equal(f.calls.length,0);
  }
});
test('unsafe identity, ancestors or missing host pins refuse without native attempt',async t=>{
  const inspect=await inspector();
  for(const mutation of [async f=>chmod(f.key,0o644),async f=>{await rm(f.key);await symlink(join(f.home,'outside'),f.key);},
    async f=>writeFile(join(f.root,'config'),f.config.replace(f.key,join(f.home,'outside'))),async f=>rm(join(f.root,'known_hosts')),
    async f=>{await rm(join(f.root,'known_hosts'));await symlink(f.key,join(f.root,'known_hosts'));},async f=>chmod(f.root,0o777),async f=>chmod(f.home,0o777),async f=>chmod(join(f.root,'known_hosts'),0o666),async f=>chmod(join(f.root,'config'),0o666),
    async f=>{f.options.uid++;},async f=>{await rm(join(f.root,'config'));await symlink(f.key,join(f.root,'config'));}]) {
    const f=await fixture(t);await mutation(f);unknown(await inspect(f.options));assert.equal(f.calls.length,0);
  }
});
test('failed, extra, malformed or oversized SSH output never becomes verified observation',async t=>{
  const f=await fixture(t),inspect=await inspector();
  for(const output of [null,[],{}, {platform:'linux',listenerCount:1,workerCount:0},{platform:'windows',listenerCount:1,workerCount:0,extra:'PRIVATE'},
    {platform:'windows',listenerCount:-1,workerCount:0},{platform:'windows',listenerCount:65,workerCount:0},
    {platform:'windows',listenerCount:'1',workerCount:0},{platform:'windows',listenerCount:1.5,workerCount:0}]) {
    unknown(await inspect({...f.options,run:async()=>({ok:true,stdout:JSON.stringify(output),stderr:''})}));
  }
  for(const result of [{ok:false,stdout:'{"platform":"windows","listenerCount":0,"workerCount":0}'},
    {ok:true,stdout:'PRIVATE'.repeat(2000)}, {ok:true,stdout:'garbage'}, {ok:true,stdout:'{"platform":"windows","listenerCount":9,"listenerCount":0,"workerCount":0}'},
    {ok:true,stdout:'{"platform":"windows","listenerCount":0,"workerCount":0}',stderr:'PRIVATE'}]) {
    unknown(await inspect({...f.options,run:async()=>result}));
  }
  unknown(await inspect({...f.options,run:async()=>{throw Error('PRIVATE_HOST_CREDENTIAL_PATH');}}));
});
test('confirmed absence is distinct from unavailable observation',async t=>{
  const f=await fixture(t);const report=await (await inspector())({...f.options,run:async()=>({ok:true,stdout:'{"platform":"windows","listenerCount":0,"workerCount":0}',stderr:''})});
  assert.equal(report.processObservationVerified,true);assert.equal(report.listenerCount,0);assert.equal(report.workerCount,0);
  assert.equal(await readFile(f.key,'utf8'),'PRIVATE_KEY_BYTES_CANARY');
});
test('process-query failure cannot be swallowed into verified absence',async t=>{
  const f=await fixture(t);await (await inspector())(f.options);
  const payload=Buffer.from(f.calls[0][1].at(-1).split(' ').at(-1),'base64').toString('utf16le');
  assert.match(payload,/Get-Process -ErrorAction Stop/);
  assert.equal((payload.match(/Get-Process/g)||[]).length,1);
  assert.doesNotMatch(payload,/SilentlyContinue/);
  unknown(await (await inspector())({...f.options,run:async()=>({ok:false,stdout:'',stderr:'PRIVATE_ACCESS_ERROR'})}));
});

test('CLI refuses retained output and preserves prior bytes, publishing only fresh sanitized absence',async t=>{
  const f=await fixture(t);await rm(join(f.root,'config'));
  const script=new URL('../scripts/goriq-zbook-runner-readonly.mjs',import.meta.url).pathname;
  const harness=`Object.defineProperty(process,"platform",{value:"darwin"});process.argv=[process.execPath,${JSON.stringify(script)}];await import(${JSON.stringify(new URL('../scripts/goriq-zbook-runner-readonly.mjs',import.meta.url).href)});`;
  const invoke=()=>spawnSync(process.execPath,['--input-type=module','--eval',harness],{cwd:f.home,encoding:'utf8',env:{...process.env,...context,HOME:f.home}});
  await mkdir(join(f.home,'.gai-results'));
  const file=join(f.home,'.gai-results','zbook-runner-readonly.json');await writeFile(file,'PRIVATE_RETAINED');
  const rejected=invoke();assert.equal(rejected.status,1);assert.equal(await readFile(file,'utf8'),'PRIVATE_RETAINED');
  assert.doesNotMatch(rejected.stderr,/PRIVATE|zbook-inspector/);
  await rm(join(f.home,'.gai-results'),{recursive:true});
  const fresh=invoke();assert.equal(fresh.status,0,fresh.stderr);unknown(JSON.parse(fresh.stdout));unknown(JSON.parse(await readFile(file,'utf8')));
});
test('nested identity symlink or writable ancestor cannot escape the fixed SSH root',async t=>{
  for(const symbolic of [false,true]) {
    const f=await fixture(t),nested=join(f.root,'nested');
    if(symbolic)await symlink(f.home,nested);else await mkdir(nested,{mode:0o777});
    await writeFile(join(f.root,'config'),f.config.replace(f.key,join(nested,'key')));
    unknown(await (await inspector())(f.options));assert.equal(f.calls.length,0);
  }
});
test('fixed process payload propagates enumeration failure and counts only the two exact process names',async t=>{
  const f=await fixture(t);await (await inspector())(f.options);
  const fixed=Buffer.from(f.calls[0][1].at(-1).split(' ').at(-1),'base64').toString('utf16le');
  const guard="if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){exit 2};";
  assert.ok(fixed.includes(guard));
  // Inert local PowerShell fixture: replace only the platform guard; never connect or list native processes.
  const body=fixed.replace(guard,'');
  const fixtures=[
    {prefix:"function Get-Process { [CmdletBinding()] param(); Write-Error 'PRIVATE_ACCESS_ERROR' };",ok:false},
    {prefix:"function Get-Process { [CmdletBinding()] param(); @([pscustomobject]@{ProcessName='Runner.Listener'},[pscustomobject]@{ProcessName='Runner.Worker'},[pscustomobject]@{ProcessName='Runner.Worker.extra'}) };",ok:true},
  ];
  for(const fixture of fixtures) {
    const run=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(fixture.prefix+body,'utf16le').toString('base64')],{encoding:'utf8',timeout:10000});
    assert.equal(run.error,undefined);assert.equal(run.status===0,fixture.ok);
    if(fixture.ok)assert.deepEqual(JSON.parse(run.stdout),{platform:'windows',listenerCount:1,workerCount:1});
    else assert.equal(run.stdout.trim(),'');
  }
});
test('readable unsupported config reports its missing prerequisite separately from absent config',async t=>{
  const f=await fixture(t);await writeFile(join(f.root,'config'),f.config+' ProxyCommand PRIVATE_COMMAND\n');
  const report=await (await inspector())(f.options);unknown(report);
  assert.equal(report.prerequisites.sshConfigReadable,true);assert.equal(report.prerequisites.literalRouteVerified,false);
  assert.equal(report.failureClass,'ssh-config-unsupported');assert.equal(f.calls.length,0);
});
test('literal ZBook alias and deterministic SSH-root identity spelling preserve existing route',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'config'),f.config.replace('Host zbook','Host ZBook').replace(f.key,'~/.ssh/PRIVATE_KEY_CANARY'));
  const report=await (await inspector())(f.options);
  assert.equal(report.processObservationVerified,true);assert.equal(f.calls.length,1);assert.ok(f.calls[0][1].includes(f.key));
});
test('case-duplicate aliases, identity traversal and owner-executable key modes refuse',async t=>{
  const inspect=await inspector();
  for(const mutation of [async f=>writeFile(join(f.root,'config'),f.config+'Host ZBook\n'),
    async f=>writeFile(join(f.root,'config'),f.config.replace(f.key,'~/.ssh/../PRIVATE_KEY_CANARY')),
    async f=>chmod(f.key,0o700)]) {
    const f=await fixture(t);await mutation(f);unknown(await inspect(f.options));assert.equal(f.calls.length,0);
  }
});
test('escaped duplicate JSON keys cannot disguise counts or schema',async t=>{
  const f=await fixture(t);
  unknown(await (await inspector())({...f.options,run:async()=>({ok:true,stdout:'{"platform":"windows","listenerCount":9,"\\u006cistenerCount":0,"workerCount":0}',stderr:''})}));
});
test('identity disappearing after metadata cannot restore OpenSSH default identity candidates',async t=>{
  const f=await fixture(t);let invocation;
  const report=await (await inspector())({...f.options,run:async(command,args)=>{
    await rm(f.key);invocation={command,args};
    return {ok:false,stdout:'',stderr:'PRIVATE_MISSING_IDENTITY'};
  }});
  assert.equal(report.prerequisites.identityMetadataVerified,true);unknown(report);
  assert.equal(invocation.command,'/usr/bin/ssh');
  assert.ok(invocation.args.some((value,index)=>value==='-o'&&invocation.args[index+1]==='IdentityFile=none'),
    'explicit none sentinel must suppress defaults if OpenSSH ignores a missing -i file');
  assert.deepEqual(invocation.args.flatMap((value,index)=>value==='-i'?[invocation.args[index+1]]:[]),[f.key],
    'only the already-validated identity may be selected');
});
test('default identity suppression preserves the selected identity for a valid existing route',async t=>{
  const f=await fixture(t);let invocation;
  const report=await (await inspector())({...f.options,run:async(command,args,options)=>{
    invocation={command,args};return f.options.run(command,args,options);
  }});
  assert.equal(report.processObservationVerified,true);assert.equal(report.listenerCount,1);
  assert.ok(invocation.args.some((value,index)=>value==='-o'&&invocation.args[index+1]==='IdentityFile=none'));
  assert.deepEqual(invocation.args.flatMap((value,index)=>value==='-i'?[invocation.args[index+1]]:[]),[f.key]);
});
