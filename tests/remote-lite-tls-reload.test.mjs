import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, Agent } from 'node:https';
import { X509Certificate, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createOwnerPortal } from '../src/remote-lite/owner-portal.mjs';
import { openRemoteRegistry } from '../src/remote-lite/registry-file.mjs';
import { loadTLSFiles, installTLSReload } from '../src/remote-lite/tls-reload.mjs';

test('certificate renewal changes new TLS handshakes while owner login and existing socket survive; invalid updates retain the working context', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-lite-renew-'));
  let portal, server, registry, agent;
  t.after(async () => {
    agent?.destroy(); portal?.close();
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    registry?.close(); rmSync(dir, { recursive: true, force: true });
  });
  const conf = join(dir, 'openssl.cnf');
  writeFileSync(conf, '[req]\ndistinguished_name=dn\n[dn]\n');
  const openssl = process.env.REMOTE_LITE_OPENSSL || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const make = (name, san = 'IP:127.0.0.1') => {
    const certPath = join(dir, name + '.pem'), keyPath = join(dir, name + '.key');
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath,
      '-out', certPath, '-days', '1', '-subj', '/CN=disposable-' + name, '-addext', 'subjectAltName=' + san, '-config', conf], { stdio: 'pipe', windowsHide: true });
    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  };
  const first = make('first', 'IP:127.0.0.1,DNS:portal.invalid');
  const second = make('second', 'DNS:portal.invalid,IP:127.0.0.1');
  const wrongName = make('wrong', 'DNS:wrong.invalid');
  const paths = { certPath: join(dir, 'active.pem'), keyPath: join(dir, 'active.key'), serverName: '127.0.0.1' };
  const replace = pair => { writeFileSync(paths.certPath, pair.cert); writeFileSync(paths.keyPath, pair.key); };
  replace(first);
  assert.doesNotThrow(() => loadTLSFiles({ ...paths, serverName: 'portal.invalid' }));
  for (const serverName of ['other.invalid', '127.0.0.2', '', undefined]) {
    assert.throws(() => loadTLSFiles({ ...paths, serverName }), /^Error: TLS_FILES_INVALID$/u);
  }
  server = createServer(loadTLSFiles(paths), (req, res) => portal.handler(req, res));
  registry = openRemoteRegistry(join(dir, 'state'), { initialize: true });
  const signals = new EventEmitter(), messages = [];
  installTLSReload(server, paths, { signals, report: message => messages.push(message) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'https://127.0.0.1:' + server.address().port;
  const ownerKey = '1'.repeat(64);
  portal = createOwnerPortal({ origin, owners: [{ ownerId: 'renew-test', keyHash: createHash('sha256').update(ownerKey).digest('hex') }], ...registry });
  agent = new Agent({ keepAlive: true, maxCachedSessions: 0, ca: [first.cert, second.cert] });
  const post = (path, payload, headers = {}, keepAlive = true) => new Promise((resolve, reject) => {
    let socket;
    const req = request(origin + path, { method: 'POST', agent: keepAlive ? agent : false,
      ca: [first.cert, second.cert], headers: { origin, 'content-type': 'application/json', ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, result: JSON.parse(Buffer.concat(chunks)).result,
        fingerprint: socket.getPeerX509Certificate()?.fingerprint256, socket,
      }));
    });
    req.on('socket', value => { socket = value; }); req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(Error('TLS renewal probe timeout'))); req.end(JSON.stringify(payload));
  });
  const login = await post('/api/login', { key: ownerKey }); assert.equal(login.status, 200);
  const auth = { cookie: login.headers['set-cookie'][0].split(';')[0], 'x-remote-csrf': login.result.csrf };
  replace(second); signals.emit('SIGHUP');
  const continued = await post('/api/devices', {}, auth);
  assert.equal(continued.status, 200); assert.equal(continued.socket, login.socket);
  const fresh = await post('/api/devices', {}, auth, false);
  assert.equal(fresh.status, 200); assert.equal(fresh.fingerprint, new X509Certificate(second.cert).fingerprint256);
  for (const bad of [wrongName, { cert: second.cert, key: first.key }, { cert: 'malformed-private-material', key: second.key }, { cert: second.cert, key: 'x'.repeat(65537) }]) {
    replace(bad); signals.emit('SIGHUP');
    const retained = await post('/api/devices', {}, auth, false);
    assert.equal(retained.status, 200); assert.equal(retained.fingerprint, fresh.fingerprint);
  }
  assert.deepEqual(messages, ['TLS_RELOAD_OK', ...Array(4).fill('TLS_RELOAD_FAILED')]);
  replace(second);
  agent.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  assert.equal(signals.listenerCount('SIGHUP'), 0);
});

test('Windows polling renews real TLS without a signal and retains the valid context on an incomplete update', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-lite-poll-renew-'));
  let server, agent;
  t.after(async () => {
    agent?.destroy();
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    rmSync(dir, { recursive: true, force: true });
  });
  const conf = join(dir, 'openssl.cnf');
  writeFileSync(conf, '[req]\ndistinguished_name=dn\n[dn]\n');
  const openssl = process.env.REMOTE_LITE_OPENSSL || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const make = name => {
    const cert = join(dir, name + '.pem'), key = join(dir, name + '.key');
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
      '-out', cert, '-days', '1', '-subj', '/CN=disposable-' + name, '-addext', 'subjectAltName=IP:127.0.0.1', '-config', conf], { stdio: 'pipe', windowsHide: true });
    return { cert: readFileSync(cert), key: readFileSync(key) };
  };
  const first = make('first'), second = make('second');
  const paths = { certPath: join(dir, 'active.pem'), keyPath: join(dir, 'active.key'), serverName: '127.0.0.1' };
  const replace = pair => { writeFileSync(paths.certPath, pair.cert); writeFileSync(paths.keyPath, pair.key); };
  replace(first);
  server = createServer(loadTLSFiles(paths), (_req, res) => res.end('ok'));
  const signals = new EventEmitter(), messages = [];
  installTLSReload(server, paths, { signals, pollIntervalMs: 20, report: message => messages.push(message) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  agent = new Agent({ keepAlive: true, maxCachedSessions: 0, ca: [first.cert, second.cert] });
  const get = (keepAlive = true) => new Promise((resolve, reject) => {
    let socket;
    const req = request({ host: '127.0.0.1', port: server.address().port, agent: keepAlive ? agent : false,
      ca: [first.cert, second.cert] }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, socket, fingerprint: socket.getPeerX509Certificate()?.fingerprint256 }));
    });
    req.on('socket', value => { socket = value; }); req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(Error('TLS poll probe timeout'))); req.end();
  });
  const waitFor = async predicate => {
    const deadline = Date.now() + 4000;
    while (!predicate() && Date.now() < deadline) await delay(10);
    assert.ok(predicate(), 'bounded poll must observe certificate change');
  };
  const before = await get(); assert.equal(before.status, 200);
  await waitFor(() => messages.includes('TLS_RELOAD_OK'));
  const oldCount = messages.length;
  replace(second);
  await waitFor(() => messages.length > oldCount && messages.at(-1) === 'TLS_RELOAD_OK');
  const continued = await get(); assert.equal(continued.socket, before.socket);
  const fresh = await get(false); assert.equal(fresh.fingerprint, new X509Certificate(second.cert).fingerprint256);
  replace({ cert: first.cert, key: second.key });
  await waitFor(() => messages.includes('TLS_RELOAD_FAILED'));
  assert.equal((await get(false)).fingerprint, fresh.fingerprint);
  replace(second);
  await delay(80);
  const stableCount = messages.length;
  await delay(80); assert.equal(messages.length, stableCount, 'unchanged pair must not reload repeatedly');
  agent.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  replace(first);
  const closedCount = messages.length;
  await delay(80); assert.equal(messages.length, closedCount, 'closed server must release polling');
  assert.equal(signals.listenerCount('SIGHUP'), 0);
});
