import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { generateKeyPairSync, sign, randomBytes, createHash, X509Certificate } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { once } from 'node:events';
import { createOwnerPortal } from '../src/remote-lite/owner-portal.mjs';
import { openRemoteRegistry } from '../src/remote-lite/registry-file.mjs';
import { RemoteLitePairingRegistry } from '../src/remote-lite/device-pairing.mjs';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'remote-lite-portal-'));
  const certFile = join(dir, 'tls.crt'), keyFile = join(dir, 'tls.key'), conf = join(dir, 'openssl.cnf');
  writeFileSync(conf, '[req]\ndistinguished_name=dn\n[dn]\n');
  const openssl = process.env.REMOTE_LITE_OPENSSL || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1',
    '-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-config',conf], { stdio: 'pipe', windowsHide: true });
  const cert = readFileSync(certFile), key = readFileSync(keyFile);
  const ownerKey = randomBytes(32).toString('hex'), otherKey = randomBytes(32).toString('hex');
  const owners = [[ownerKey,'friend'],[otherKey,'another']].map(([k, ownerId]) => ({ ownerId, keyHash: createHash('sha256').update(k).digest('hex') }));
  const registryPath = join(dir, 'registry');
  let registry = openRemoteRegistry(registryPath, { initialize: true }), portal;
  let now = Date.now();
  let heldStart = null;
  const server = createServer({ cert, key }, (req, res) => {
    if (req.url === '/api/start' && heldStart) {
      const held = heldStart; heldStart = null;
      const end = res.end.bind(res);
      res.end = (...args) => { held.started(); held.releaseResponse = () => end(...args); return res; };
    }
    void portal.handler(req, res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'https://127.0.0.1:' + server.address().port;
  portal = createOwnerPortal({ origin, owners, ...registry, now: () => now });
  t.after(async () => { portal.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); registry.close(); rmSync(dir, { recursive: true, force: true }); });
  const post = (path, payload, headers = {}) => new Promise((resolve, reject) => {
    const req = request(origin + path, { method: 'POST', ca: cert, headers: { 'content-type': 'application/json', ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, ...JSON.parse(Buffer.concat(chunks)) }); } catch (e) { reject(e); }
      });
    }); req.on('error', reject); req.setTimeout(8000, () => req.destroy(new Error('HTTPS test timeout'))); req.end(JSON.stringify(payload));
  });
  const login = async key => {
    const r = await post('/api/login', { key }, { origin }); assert.equal(r.status, 200);
    return { origin, cookie: r.headers['set-cookie'][0].split(';')[0], 'x-remote-csrf': r.result.csrf };
  };
  const enroll = async (h, suppliedInvite) => {
    const invite = suppliedInvite ? { status: 200, result: { inviteCode: suppliedInvite } } : await post('/api/invite', {}, h); assert.equal(invite.status, 200);
    const keys = generateKeyPairSync('ed25519'); const deviceId = 'windows-' + randomBytes(4).toString('hex');
    const proposed = await post('/v1/device/propose', { inviteCode: invite.result.inviteCode, deviceId, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }) });
    assert.equal(proposed.status, 200);
    const p = proposed.result;
    const proved = await post('/v1/device/prove', { requestId: p.requestId, signature: sign(null, Buffer.from(RemoteLitePairingRegistry.enrollmentMessage({ ...p, deviceId })), keys.privateKey).toString('base64') });
    assert.equal(proved.status, 200);
    return { keys, deviceId, requestId: p.requestId, expectedFingerprint: p.fingerprint };
  };
  return { origin, ownerKey, otherKey, post, login, enroll, cert, key, registryPath,
    spki: createHash('sha256').update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64'),
    advance(ms) { now += ms; },
    holdNextStart() {
      const held = {}; held.promise = new Promise(resolve => { held.started = resolve; }); heldStart = held;
      return { started: held.promise, release() { held.releaseResponse(); } };
    },
    restart() { portal.close(); registry.close(); registry = openRemoteRegistry(registryPath); portal = createOwnerPortal({ origin, owners, ...registry, now: () => now }); },
  };
}

test('real HTTPS login/CSRF/owner isolation/enrollment/restart and logout invalidate native authority', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/login', { key: f.ownerKey }, { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await f.post('/api/login', { key: f.ownerKey, ownerId: 'other' }, { origin: f.origin })).status, 400);
  let h = await f.login(f.ownerKey);
  const raw = await f.post('/api/login', { key: f.otherKey }, { origin: f.origin });
  assert.match(raw.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await f.post('/api/invite', {}, { ...h, 'x-remote-csrf': 'wrong' })).status, 403);
  const d = await f.enroll(h);
  const other = await f.login(f.otherKey);
  assert.deepEqual((await f.post('/api/devices', {}, other)).result, { registered: [], pending: [] });
  assert.equal((await f.post('/api/approve', { requestId: d.requestId, expectedFingerprint: d.expectedFingerprint }, other)).status, 403);
  assert.equal((await f.post('/api/approve', { requestId: d.requestId, expectedFingerprint: d.expectedFingerprint }, h)).status, 200);
  f.restart();
  assert.equal((await f.post('/api/devices', {}, h)).status, 403);
  h = await f.login(f.ownerKey);
  assert.equal((await f.post('/api/devices', {}, h)).result.registered[0].deviceId, d.deviceId);
  const started = await f.post('/api/start', { deviceId: d.deviceId }, h);
  assert.equal(started.status, 200); assert.equal('viewerToken' in started.result, false);
  const sessionId = started.result.sessionId;
  assert.equal((await f.post('/api/viewer/status', { sessionId }, other)).status, 403);
  const challenge = await f.post('/v1/device/challenge', { deviceId: d.deviceId, sessionId, operation: 'session-accept' });
  assert.equal(challenge.status, 200);
  const proof = { deviceId: d.deviceId, sessionId, operation: 'session-accept', challengeId: challenge.result.challengeId };
  proof.signature = sign(null, Buffer.from(RemoteLitePairingRegistry.deviceMessage({ ...proof, challenge: challenge.result.challenge })), d.keys.privateKey).toString('base64');
  assert.equal((await f.post('/v1/device/accept', { deviceId: d.deviceId, sessionId, proof })).status, 200);
  assert.equal((await f.post('/api/viewer/status', { sessionId }, h)).result.status, 'active');
  assert.equal((await f.post('/api/logout', {}, h)).status, 200);
  assert.equal((await f.post('/v1/device/challenge', { deviceId: d.deviceId, sessionId, operation: 'session-status' })).status, 403);
  h = await f.login(f.ownerKey);
  // Keep only the login alive until ten seconds before its absolute deadline.
  // Then establish a fresh active device session whose own deadline is later.
  for (let i = 0; i < 71; i++) {
    f.advance(10 * 60_000);
    assert.equal((await f.post('/api/session', {}, h)).status, 200);
  }
  f.advance(9 * 60_000 + 50_000);
  const next = await f.post('/api/start', { deviceId: d.deviceId }, h);
  assert.equal(next.status, 200);
  const nextChallenge = await f.post('/v1/device/challenge', { deviceId: d.deviceId, sessionId: next.result.sessionId, operation: 'session-accept' });
  const nextProof = { deviceId: d.deviceId, sessionId: next.result.sessionId, operation: 'session-accept', challengeId: nextChallenge.result.challengeId };
  nextProof.signature = sign(null, Buffer.from(RemoteLitePairingRegistry.deviceMessage({ ...nextProof, challenge: nextChallenge.result.challenge })), d.keys.privateKey).toString('base64');
  assert.equal((await f.post('/v1/device/accept', { deviceId: d.deviceId, sessionId: next.result.sessionId, proof: nextProof })).status, 200);
  assert.equal((await f.post('/api/viewer/status', { sessionId: next.result.sessionId }, h)).result.status, 'active');
  assert.equal((await f.post('/v1/device/challenge', { deviceId: d.deviceId, sessionId: next.result.sessionId, operation: 'session-status' })).status, 200);
  f.advance(11_000); // only login expires; the newly active device session still had almost10min
  assert.equal((await f.post('/v1/device/challenge', { deviceId: d.deviceId, sessionId: next.result.sessionId, operation: 'session-status' })).status, 403);
  h = await f.login(f.ownerKey);
  assert.equal((await f.post('/api/revoke', { deviceId: d.deviceId }, h)).status, 200);
  f.restart(); h = await f.login(f.ownerKey);
  assert.deepEqual((await f.post('/api/devices', {}, h)).result.registered, []);
});

test('registry disk excludes another writer and refuses missing/corrupt startup', t => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-lite-registry-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'state'); const r = openRemoteRegistry(root, { initialize: true });
  assert.throws(() => openRemoteRegistry(root)); r.close();
  writeFileSync(join(root, 'devices.json'), '{corrupt'); assert.throws(() => openRemoteRegistry(root));
  assert.throws(() => openRemoteRegistry(join(dir, 'missing')));
});

test('real Chrome owner invitation/approval/device selection and logout UI', { skip: process.env.REMOTE_LITE_PORTAL_BROWSER !== '1' }, async t => {
  const f = await fixture(t);
  const { verifyOwnerPortalBrowser } = await import('../scripts/remote-lite-owner-browser-vm.mjs');
  await verifyOwnerPortalBrowser({ origin: f.origin, spki: f.spki, ownerKey: f.ownerKey,
    enroll: async invite => f.enroll(await f.login(f.ownerKey), invite), holdNextStart: f.holdNextStart });
});
