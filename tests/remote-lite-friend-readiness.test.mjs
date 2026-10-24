import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { inspectFriendActivation } from '../src/remote-lite/friend-activation-readiness.mjs';
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
  const r=inspectFriendActivation(f.wrapper);
  assert.equal(r.configured,true,JSON.stringify(r));
  assert.ok(Object.values(r.checks).every(Boolean));
  assert.equal(r.deploymentAccepted,false);
  assert.equal(r.deviceAndFriendAccountAccepted,false);
  assert.equal(r.physicalIphoneAccepted,false);
  assert.equal(r.distributionSignedAndAccepted,false);
  assert.equal(r.requiredGates.length,5);
  assert.doesNotMatch(JSON.stringify(r),new RegExp(f.key));
  assert.doesNotMatch(JSON.stringify(r),new RegExp(f.tlsKey.replaceAll('\\','\\\\')));
  const actual=spawnSync(process.execPath,['scripts/remote-lite-friend-activation-check.mjs',f.wrapper],{encoding:'utf8'});
  assert.equal(actual.status,0,actual.stderr);
  assert.deepEqual(JSON.parse(actual.stdout),r);
  assert.equal(readFileSync(join(f.registry,'devices.json'),'utf8'),'{\n  "version": 1,\n  "devices": []\n}\n'.replace(/^/,'').length ? readFileSync(join(f.registry,'devices.json'),'utf8') : '');
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
