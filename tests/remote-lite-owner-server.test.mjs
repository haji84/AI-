import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { createOwnerPortal } from '../src/remote-lite/owner-portal.mjs';
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
  // A live friend child is now deliberately restricted to a real owner-approved
  // Tailscale private address on TCP8443. CI must NOT bypass that safety rule.
  // The following is a negative serving-path acceptance, not a fake live pass.
  child.kill(); await exited;
  const friendState = join(dir, 'friend-state');
  openRemoteRegistry(friendState, { initialize: true }).close();
  writeFileSync(config, JSON.stringify({ ...baseConfig, stateDirectory: friendState }));
  const wrapper = join(dir, 'goriq-friend.json');
  writeFileSync(wrapper, JSON.stringify({ version: 1,
    ownerOrigins: ['https://goriq-owner-test.invalid'], portalConfig: config }));
  const registryBytes = readFileSync(join(friendState,'devices.json'));
  child = spawn(process.execPath, ['scripts/remote-lite-owner-server.mjs', wrapper, '--goriq-friend'],
    { windowsHide:true, stdio:['ignore','pipe','pipe','ipc'] });
  let hostedError = ''; child.stderr.on('data', value => { hostedError += value.toString(); });
  exited = once(child,'exit');
  const [deniedExit] = await exited;
  assert.equal(deniedExit, 1);
  assert.match(hostedError,/GORIQ_FRIEND_LISTENER_SCOPE_INVALID/u);
  assert.equal(existsSync(join(friendState,'registry.lock')),false);
  assert.deepEqual(readFileSync(join(friendState,'devices.json')),registryBytes);

  // Keep the real HTTPS portal/host and durable registry positive test on
  // loopback, without claiming the friend child accepted an unsafe local bind.
  // Owned-child IPC and parent disappearance remain covered independently by
  // tests/remote-lite-goriq-hosted.test.mjs. Real NIC/ACL tests are Human Gates.
  const openLocalPortal = async () => {
    const storage = openRemoteRegistry(friendState);
    const portal = createOwnerPortal({ origin:baseConfig.origin, owners:baseConfig.owners,
      ...storage });
    const httpsServer=createHttpsServer({cert:readFileSync(cert),key:readFileSync(key),
      maxHeaderSize:8192},portal.handler);
    httpsServer.maxHeadersCount=48;
    await new Promise((resolve,reject)=>{
      httpsServer.once('error',reject);
      httpsServer.listen({host:'127.0.0.1',port,exclusive:true},resolve);
    });
    return async () => {
      portal.close();
      httpsServer.closeAllConnections();
      await new Promise((resolve,reject)=>httpsServer.close(error=>error?reject(error):resolve()));
      storage.close();
    };
  };
  let closePortal=await openLocalPortal();
  try {
    assert.match(await send(1),/^HTTP\\/1\\.1 200 /u);
    assert.match(await send(1,false,'goriq-owner-test.invalid'),/^HTTP\\/1\\.1 403 /u);
  } finally { await closePortal(); }
  assert.equal(existsSync(join(friendState,'registry.lock')),false);
  assert.deepEqual(readFileSync(join(friendState,'devices.json')),registryBytes);
  const reopened=openRemoteRegistry(friendState);reopened.close();
  closePortal=await openLocalPortal();
  try { assert.match(await send(1),/^HTTP\\/1\\.1 200 /u); }
  finally { await closePortal(); }
  assert.deepEqual(readFileSync(join(friendState,'devices.json')),registryBytes);
  t.diagnostic('Loopback HTTPS/registry remain testable; hosted friend private bind stays fail-closed');
});
