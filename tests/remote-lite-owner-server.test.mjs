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

test('operator HTTPS accepts bounded proxy/browser headers and still rejects excess bytes, count and wrong Host', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-lite-operator-'));
  const openssl = process.env.REMOTE_LITE_OPENSSL || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem'), conf = join(dir, 'openssl.cnf');
  writeFileSync(conf, '[req]\ndistinguished_name=dn\n[dn]\n');
  execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1',
    '-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-config',conf], {stdio:'pipe',windowsHide:true});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;probe.close();await once(probe,'close');
  const config=join(dir,'config.json');
  writeFileSync(config,JSON.stringify({origin:'https://remote-lite-test.invalid',listenHost:'127.0.0.1',listenPort:port,
    tlsCert:cert,tlsKey:key,stateDirectory:join(dir,'state'),owners:[{ownerId:'test',keyHash:'a'.repeat(64)}],
    stun:{urls:['stun:stun.cloudflare.com:3478']}}));
  const child=spawn(process.execPath,['scripts/remote-lite-owner-server.mjs',config,'--initialize'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stderr.resume();
  const exited=once(child,'exit');
  t.after(async()=>{child.kill();await exited;rmSync(dir,{recursive:true,force:true});});
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
});
