import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, Agent } from 'node:https';
import { X509Certificate, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { EventEmitter, once } from 'node:events';
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
