import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';
import { URL } from 'node:url';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { ManualRemoteCoordinator } from '../../../src/remote-lite/manual-coordinator.mjs';
import { createLoopbackSignaling } from '../../../src/remote-lite/loopback-signaling.mjs';
import { createPortalTurnIssuer, issueTurnCredentials } from '../../../src/remote-lite/turn-credentials.mjs';

const ownerId = 'android-vm-owner';
const authorization = randomBytes(24).toString('hex');
const bridge = randomBytes(24).toString('hex');
// Disposable loopback fixture only, never copied into a native release resource.
const turnSecret = 'public-vm-turn-secret-never-a-production-secret-1831';
const coordinator = new ManualRemoteCoordinator({
  iceForSession: createPortalTurnIssuer({ sharedSecret: turnSecret,
    urls: ['turn:10.0.2.2:43478?transport=tcp'] }),
  authorizeOwner: ({ ownerId: candidate, authorization: supplied }) =>
    candidate === ownerId && supplied === authorization,
});
let revokedDeviceId = null;
let revokedRejectionRecorded = false;
const revokeDevice = coordinator.revokeDevice.bind(coordinator);
coordinator.revokeDevice = input => {
  const result = revokeDevice(input);
  if (result.status === 'revoked') {
    revokedDeviceId = input.deviceId;
    revokedRejectionRecorded = false;
  }
  return result;
};
// The independent status and signaling workers race legitimately after revocation.
// Observe the first real refusal without changing the coordinator's result. A
// denied challenge is evidence of refusal, not of signature verification.
const liveOperations = new Set(['session-status', 'signal-receive', 'signal-send']);
function observeRefusal(method, operation, phase) {
  const original = coordinator[method].bind(coordinator);
  coordinator[method] = input => {
    try { return original(input); }
    catch (error) {
      const actualOperation = operation || input.operation;
      if (!revokedRejectionRecorded && input.deviceId === revokedDeviceId &&
        liveOperations.has(actualOperation) && typeof input.sessionId === 'string' &&
        ['DEVICE_UNAVAILABLE', 'CHALLENGE_NOT_FOUND_OR_MISMATCH', 'DEVICE_REVOKED'].includes(error.code)) {
        revokedRejectionRecorded = true;
        process.stdout.write(JSON.stringify({ event: 'revoked-request-rejected',
          deviceId: input.deviceId, sessionId: input.sessionId, operation: actualOperation,
          phase, code: error.code }) + '\n');
      }
      throw error;
    }
  };
}
observeRefusal('challengeDevice', null, 'challenge');
observeRefusal('deviceStatus', 'session-status', 'signed-request');
observeRefusal('receiveSignalsForDevice', 'signal-receive', 'signed-request');
observeRefusal('deviceSignal', 'signal-send', 'signed-request');
const server = createLoopbackSignaling({
  coordinator,
  authenticateOwnerRequest: req => req.headers['x-vm-owner'] === authorization
    ? { ownerId, authorization } : null,
});
const address = await server.start();
// Local TLS wrapper for the Android system-trust test. This proxy has one fixed
// loopback destination; it is never a public or user-configurable proxy.
const secure = createServer({
  pfx: readFileSync(new URL('../app/build/vm-tls/server.p12', import.meta.url)),
  passphrase: 'vm-fixture-only',
}, (req, res) => {
  const staticFiles = new Map([
    ['/vm/viewer', new URL('./native_viewer.html', import.meta.url)],
    ...['browser-webrtc.mjs', 'manual-protocol.mjs', 'device-signature-format.mjs']
      .map(name => ['/vm/' + name, new URL('../../../src/remote-lite/' + name, import.meta.url)]),
  ]);
  if (req.method === 'GET' && staticFiles.has(req.url)) {
    res.writeHead(200, { 'Content-Type': req.url === '/vm/viewer' ? 'text/html; charset=utf-8' : 'text/javascript',
      'Cache-Control': 'no-store' });
    res.end(readFileSync(staticFiles.get(req.url)));
    return;
  }
  const vmOperation = { '/vm/signal': '/v1/viewer/signal', '/vm/poll': '/v1/viewer/poll' }[req.url];
  if (req.url.startsWith('/vm/')) {
    // Test-only same-origin bridge to exactly two viewer operations. No arbitrary proxy.
    if (!vmOperation || req.method !== 'POST' || req.headers['x-vm-bridge'] !== bridge ||
      req.headers.origin !== `https://127.0.0.1:${secure.address().port}` || req.headers.cookie) {
      res.writeHead(403); res.end(); return;
    }
  }
  const headers = vmOperation
    ? { 'content-type': 'application/json', 'x-vm-owner': authorization,
      ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}) }
    : req.headers;
  const forwarded = request({ hostname: '127.0.0.1', port: address.port,
    method: req.method, path: vmOperation || req.url,
    headers: { ...headers, host: `127.0.0.1:${address.port}` } }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  forwarded.on('error', () => { res.writeHead(502); res.end(); });
  // Deliberate test latency: each device HTTPS request adds100ms, including input authorization.
  if (req.url.startsWith('/v1/device/')) setTimeout(() => req.pipe(forwarded), 100);
  else req.pipe(forwarded);
});
await new Promise((resolve, reject) => {
  secure.once('error', reject);
  secure.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
});
const port = secure.address().port;
const invite = coordinator.issueInvite({ ownerId, authorization });
const certificate = new X509Certificate(readFileSync(new URL('../app/build/generated/vm-res/raw/remote_lite_vm_ca.pem', import.meta.url)));
const spki = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
process.stdout.write(JSON.stringify({ port, origin: `https://127.0.0.1:${port}`, inviteCode: invite.inviteCode,
  ownerAuthorization: authorization, bridge, spki,
  turnIceServers: issueTurnCredentials({ sharedSecret: turnSecret, urls: ['turn:127.0.0.1:43478?transport=tcp'],
    principalId: ownerId, sessionId: 'vm-viewer-fixture', authorize: () => true, ttlSeconds: 600 }).iceServers }) + '\n');
process.on('SIGTERM', async () => {
  secure.closeAllConnections();
  await new Promise(resolve => secure.close(resolve));
  await server.stop();
  process.exit(0);
});
