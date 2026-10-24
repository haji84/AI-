import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { inspectFriendActivation, inspectPrivateFriendBindCandidate } from '../src/remote-lite/friend-activation-readiness.mjs';
import { openRemoteRegistry } from '../src/remote-lite/registry-file.mjs';

function isolated(t) {
  const root = mkdtempSync(join(tmpdir(), 'remote-lite-friend-readiness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const conf = join(root, 'openssl.cnf');
  writeFileSync(conf, '[req]\ndistinguished_name=dn\n[dn]\n');
  const openssl = process.env.REMOTE_LITE_OPENSSL ||
    (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const tlsCert = join(root, 'portal.crt'), tlsKey = join(root, 'portal.key');
  execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',tlsKey,'-out',tlsCert,'-days','1','-subj','/CN=friend.example.test',
    '-addext','subjectAltName=DNS:friend.example.test','-config',conf],
  { stdio:'pipe', windowsHide:true });
  const registry = join(root, 'registry');
  openRemoteRegistry(registry, {initialize:true}).close();
  const key = randomBytes(32).toString('hex');
  const portal = join(root,'portal.json'), wrapper = join(root,'wrapper.json');
  const config = {
    origin:'https://friend.example.test',listenHost:'127.0.0.1',listenPort:8443,
    tlsCert,tlsKey,stateDirectory:registry,
    owners:[{ownerId:'friend-01',keyHash:createHash('sha256').update(key).digest('hex')}],
    stun:{urls:['stun:stun.cloudflare.com:3478']},
  };
  const binding = { version:1, ownerOrigins:['https://owner.example.test'], portalConfig:portal };
  const save = (c=config,b=binding) => {
    writeFileSync(portal,JSON.stringify(c));writeFileSync(wrapper,JSON.stringify(b));
  };
  save();
  return {root,portal,wrapper,config,binding,save,tlsCert,tlsKey,registry,key};
}

test('friend readiness detects only verified local HTTPS/login/registry/ICE without claiming live activation',t=>{
  const f=isolated(t);
  const originalRegistry=readFileSync(join(f.registry,'devices.json'),'utf8');
  const r=inspectFriendActivation(f.wrapper);
  assert.equal(r.configured,true,JSON.stringify(r));
  assert.ok(Object.values(r.checks).every(Boolean));
  assert.equal(r.deploymentAccepted,false);
  assert.equal(r.deviceAndFriendAccountAccepted,false);
  assert.equal(r.physicalIphoneAccepted,false);
  assert.equal(r.distributionSignedAndAccepted,false);
  assert.equal(r.requiredGates.length,5);
  assert.doesNotMatch(JSON.stringify(r),new RegExp(f.key));
  assert.equal(JSON.stringify(r).includes(f.tlsKey),false);
  const actual=spawnSync(process.execPath,['scripts/remote-lite-friend-activation-check.mjs',f.wrapper],{encoding:'utf8'});
  assert.equal(actual.status,0,actual.stderr);
  assert.deepEqual(JSON.parse(actual.stdout),r);
  assert.equal(readFileSync(join(f.registry,'devices.json'),'utf8'),originalRegistry);
});

test('wrong management hostname, missing registry or invalid TLS cannot pass readiness',t=>{
  const f=isolated(t);
  f.save(f.config,{...f.binding,ownerOrigins:[f.config.origin]});
  assert.equal(inspectFriendActivation(f.wrapper).configured,false);
  f.save({...f.config,owners:[]});
  assert.ok(inspectFriendActivation(f.wrapper).blockers.includes('FRIEND_LOGIN_CONFIGURATION_INVALID'));
  f.save({...f.config,tlsCert:join(f.root,'missing.pem')});
  assert.ok(inspectFriendActivation(f.wrapper).blockers.includes('FRIEND_LOCAL_TLS_IDENTITY_INVALID'));
  f.save({...f.config,stun:{urls:['stun:attacker.invalid:3478']}});
  assert.ok(inspectFriendActivation(f.wrapper).blockers.includes('FRIEND_ICE_MODE_UNCONFIRMED'));
  f.save();
  unlinkSync(join(f.registry,'devices.json'));
  assert.ok(inspectFriendActivation(f.wrapper).blockers.includes('FRIEND_REGISTRY_UNAVAILABLE'));
});

test('invalid friend readiness never prints private config or starts an account or service',t=>{
  const f=isolated(t);
  f.save({...f.config,owners:[{ownerId:'friend-01',keyHash:'secret-invalid'}]});
  const result=spawnSync(process.execPath,['scripts/remote-lite-friend-activation-check.mjs',f.wrapper],
    {encoding:'utf8'});
  assert.equal(result.status,2);
  assert.equal(JSON.parse(result.stdout).configured,false);
  assert.doesNotMatch(result.stdout,/secret-invalid|portal\.key|friend-01/);
  assert.doesNotMatch(result.stderr,/secret-invalid|portal\.key/);
});


test('private Tailscale TCP8443 bind is a syntactic candidate only, never evidence of authorization', t => {
  const f = isolated(t);
  const initial = inspectFriendActivation(f.wrapper);
  assert.equal(initial.configured, true);
  assert.equal(initial.privateBind.candidate, false);
  assert.deepEqual(initial.privateBindBlockers,
    ['FRIEND_TAILSCALE_PRIVATE_BIND_NOT_VERIFIED']);
  assert.equal(initial.privateBind.actualHostInterfaceVerified, false);
  assert.equal(initial.privateBind.friendNetworkPolicyVerified, false);
  assert.equal(initial.privateBind.friendOnlyReachabilityVerified, false);

  const originalRegistry = readFileSync(join(f.registry, 'devices.json'), 'utf8');
  for (const host of ['0.0.0.0', '127.0.0.1', '::', '::1',
    '192.168.1.14', '172.16.1.1', '100.63.255.254', '100.128.0.1',
    '100.64.0.1 ', '100.64.999.3', 'not-an-interface']) {
    const candidate = inspectPrivateFriendBindCandidate({listenHost: host, listenPort: 8443});
    assert.equal(candidate.candidate, false, host);
    assert.equal(candidate.friendNetworkPolicyVerified, false);
  }
  for (const port of [443, 8444, 0, -1, 65536, '8443', null]) {
    assert.equal(inspectPrivateFriendBindCandidate({listenHost: '100.72.5.9', listenPort: port}).candidate, false);
  }
  for (const host of ['100.64.0.1', '100.80.21.8', '100.127.255.254']) {
    f.save({...f.config, listenHost: host});
    const inspected = inspectFriendActivation(f.wrapper);
    assert.equal(inspected.privateBind.candidate, true, host);
    assert.deepEqual(inspected.privateBindBlockers, []);
    assert.equal(inspected.configured, true);
    assert.equal(inspected.deploymentAccepted, false);
    assert.equal(inspected.privateBind.actualHostInterfaceVerified, false);
    assert.equal(inspected.privateBind.friendNetworkPolicyVerified, false);
    assert.equal(inspected.privateBind.friendOnlyReachabilityVerified, false);
    assert.doesNotMatch(JSON.stringify(inspected), new RegExp(host.replaceAll('.', '\\.')));
  }
  f.save({...f.config, listenHost: '100.72.5.9', listenPort: 443});
  assert.deepEqual(inspectFriendActivation(f.wrapper).privateBindBlockers,
    ['FRIEND_PRIVATE_TCP8443_NOT_PLANNED']);
  assert.equal(readFileSync(join(f.registry, 'devices.json'), 'utf8'), originalRegistry);
});
