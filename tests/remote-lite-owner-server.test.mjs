import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { connect, checkServerIdentity } from 'node:tls';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { openRemoteRegistry } from '../src/remote-lite/registry-file.mjs';

test('operator HTTPS accepts bounded proxy/browser headers and still rejects excess bytes, count and wrong Host', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-lite-operator-'));
  let child, exited;
  t.after(async()=>{if(child){child.kill();await exited;}rmSync(dir,{recursive:true,force:true});});
  const openssl = process.env.REMOTE_LITE_OPENSSL || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem'), conf = join(dir, 'openssl.cnf');
  writeFileSync(conf, '[req]\ndistinguished_name=dn\n[dn]\n');
  execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1',
    '-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-config',conf], {stdio:'pipe',windowsHide:true});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;probe.close();await once(probe,'close');
  const config=join(dir,'config.json');
  const baseConfig={origin:'https://remote-lite-test.invalid',listenHost:'127.0.0.1',listenPort:port,tlsServerName:'127.0.0.1',
    tlsCert:cert,tlsKey:key,stateDirectory:join(dir,'state'),owners:[{ownerId:'test',keyHash:'a'.repeat(64)}],
    stun:{urls:['stun:stun.cloudflare.com:3478']}};
  // A proxy's verified loopback TLS name must be explicit; it cannot weaken a
  // publicly bound listener or suppress certificate identity validation.
  let attempt=0;
  for (const change of [{tlsServerName:undefined},{listenHost:'0.0.0.0'},{tlsServerName:'wrong.invalid'}]) {
    writeFileSync(config,JSON.stringify({...baseConfig,...change,stateDirectory:join(dir,'invalid-'+attempt++)}));
    assert.throws(()=>execFileSync(process.execPath,['scripts/remote-lite-owner-server.mjs',config,'--initialize'],
      {windowsHide:true,stdio:'pipe',timeout:5000}),error=>error.status===1 && /TLS_(FILES_INVALID|SERVER_NAME_INVALID)/u.test(error.stderr.toString()));
  }
  writeFileSync(config,JSON.stringify(baseConfig));
  child=spawn(process.execPath,['scripts/remote-lite-owner-server.mjs',config,'--initialize'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stderr.resume();
  exited=once(child,'exit');
  let timeout;
  try {await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error('operator exited');}),
    new Promise((_,reject)=>{timeout=globalThis.setTimeout(()=>reject(Error('operator startup timeout')),10000);})]);}
  finally {globalThis.clearTimeout(timeout);}
  const send=(count,large=false,host='remote-lite-test.invalid')=>new Promise((resolve,reject)=>{
    const socket=connect({host:'127.0.0.1',port,ca:readFileSync(cert),checkServerIdentity:(_,peer)=>checkServerIdentity('127.0.0.1',peer)},()=>{
      const headers=Array.from({length:count},(_,i)=>`X-Proxy-${i}: a\r\n`).join('');
      socket.write(`GET / HTTP/1.1\r\n${headers}${large?'X-Large: '+'a'.repeat(9000)+'\r\n':''}Host: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let result='';socket.on('data',data=>{result+=data;});socket.on('end',()=>resolve(result.split('\r\n')[0]));
    socket.on('error',reject);socket.setTimeout(5000,()=>socket.destroy(Error('HTTPS probe timeout')));
  });
  assert.match(await send(32),/^HTTP\/1\.1 200 /u);
  assert.match(await send(48),/^HTTP\/1\.1 431 /u);
  assert.match(await send(1,true),/^HTTP\/1\.1 431 /u);
  assert.match(await send(32,false,'wrong.invalid'),/^HTTP\/1\.1 403 /u);
  if (process.platform !== 'win32') {
    // Exercise the actual operator CLI's OS signal wiring on Linux CI as well
    // as the cross-platform real TLS/context/login test in tls-reload.test.mjs.
    execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1',
      '-subj','/CN=renewed-loopback','-addext','subjectAltName=IP:127.0.0.1','-config',conf], {stdio:'pipe',windowsHide:true});
    const reloaded = once(child.stderr, 'data');
    let reloadTimeout;
    try {
      child.kill('SIGHUP');
      const [message] = await Promise.race([reloaded, exited.then(()=>{throw Error('operator exited on reload');}),
        new Promise((_,reject)=>{reloadTimeout=globalThis.setTimeout(()=>reject(Error('reload timeout')),5000);})]);
      assert.equal(message.toString().trim(), 'TLS_RELOAD_OK');
    } finally { globalThis.clearTimeout(reloadTimeout); }
    assert.match(await send(32),/^HTTP\/1\.1 200 /u);
    t.diagnostic('Actual operator Linux SIGHUP served the renewed TLS certificate');
  }
  // Start friend mode with a separately prepared test registry. Windows kill()
  // above is forcible and its old lock is intentionally not reused or removed.
  child.kill(); await exited;
  const friendState = join(dir, 'friend-state');
  openRemoteRegistry(friendState, { initialize: true }).close();
  writeFileSync(config, JSON.stringify({ ...baseConfig, stateDirectory: friendState }));
  const wrapper = join(dir, 'goriq-friend.json');
  writeFileSync(wrapper, JSON.stringify({ version: 1, ownerOrigins: ['https://goriq-owner-test.invalid'], portalConfig: config }));
  child = spawn(process.execPath, ['scripts/remote-lite-owner-server.mjs', wrapper, '--goriq-friend'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let hostedError = ''; child.stderr.on('data', value => { hostedError += value; }); exited = once(child, 'exit');
  try { await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw Error('hosted portal exited: ' + hostedError); }),
    new Promise((_, reject) => { timeout = globalThis.setTimeout(() => reject(Error('hosted portal startup timeout')), 10000); })]); }
  finally { globalThis.clearTimeout(timeout); }
  assert.match(await send(1), /^HTTP\/1\.1 200 /u);
  assert.match(await send(1, false, 'goriq-owner-test.invalid'), /^HTTP\/1\.1 403 /u);
  const registryBytes = readFileSync(join(friendState, 'devices.json'));
  await new Promise((resolve, reject) => child.send({ type: 'goriq-friend-stop' }, error => error ? reject(error) : resolve()));
  try { await Promise.race([exited,
    new Promise((_, reject) => { timeout = globalThis.setTimeout(() => reject(Error('friend graceful stop timeout')), 3000); })]); }
  finally { globalThis.clearTimeout(timeout); }
  assert.equal(existsSync(join(friendState, 'registry.lock')), false);
  assert.deepEqual(readFileSync(join(friendState, 'devices.json')), registryBytes);
  // Normal close permits a second open without deleting lock/data or initializing.
  const reopened = openRemoteRegistry(friendState); reopened.close();
  child = spawn(process.execPath, ['scripts/remote-lite-owner-server.mjs', wrapper, '--goriq-friend'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stderr.resume(); exited = once(child, 'exit');
  try { await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw Error('orphan fixture exited early'); }),
    new Promise((_, reject) => { timeout = globalThis.setTimeout(() => reject(Error('orphan startup timeout')), 3000); })]); }
  finally { globalThis.clearTimeout(timeout); }
  child.disconnect();
  try { await Promise.race([exited,
    new Promise((_, reject) => { timeout = globalThis.setTimeout(() => reject(Error('running orphan stop timeout')), 3000); })]); }
  finally { globalThis.clearTimeout(timeout); }
  assert.equal(existsSync(join(friendState, 'registry.lock')), false);
  assert.deepEqual(readFileSync(join(friendState, 'devices.json')), registryBytes);
  // A disappearing parent also closes its real listener/registry. Disconnect
  // immediately, including while the child is still starting.
  child = spawn(process.execPath, ['scripts/remote-lite-owner-server.mjs', wrapper, '--goriq-friend'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderr.resume(); exited = once(child, 'exit');
  child.disconnect();
  try { await Promise.race([exited,
    new Promise((_, reject) => { timeout = globalThis.setTimeout(() => reject(Error('orphan stop timeout')), 3000); })]); }
  finally { globalThis.clearTimeout(timeout); }
  assert.equal(existsSync(join(friendState, 'registry.lock')), false);
  assert.deepEqual(readFileSync(join(friendState, 'devices.json')), registryBytes);
  t.diagnostic('Actual GORIQ friend HTTPS and IPC stop preserved registry and allowed reopen without initialization');
});
