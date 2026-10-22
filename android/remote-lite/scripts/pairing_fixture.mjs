import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';
import process from 'node:process';
import { ManualRemoteCoordinator } from '../../../src/remote-lite/manual-coordinator.mjs';
import { createLoopbackSignaling } from '../../../src/remote-lite/loopback-signaling.mjs';

const ownerId = 'android-vm-owner';
const authorization = randomBytes(24).toString('hex');
const coordinator = new ManualRemoteCoordinator({
  authorizeOwner: ({ ownerId: candidate, authorization: supplied }) =>
    candidate === ownerId && supplied === authorization,
});
let revokedDeviceId = null;
const revokeDevice = coordinator.revokeDevice.bind(coordinator);
coordinator.revokeDevice = input => {
  const result = revokeDevice(input);
  if (result.status === 'revoked') revokedDeviceId = input.deviceId;
  return result;
};
const challengeDevice = coordinator.challengeDevice.bind(coordinator);
coordinator.challengeDevice = input => {
  try { return challengeDevice(input); }
  catch (error) {
    if (input.deviceId === revokedDeviceId && input.operation === 'session-status' &&
      error.code === 'DEVICE_UNAVAILABLE') {
      process.stdout.write(JSON.stringify({ event: 'revoked-status-rejected',
        deviceId: input.deviceId, sessionId: input.sessionId, code: error.code }) + '\n');
    }
    throw error;
  }
};
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
  const forwarded = request({ hostname: '127.0.0.1', port: address.port,
    method: req.method, path: req.url,
    headers: { ...req.headers, host: `127.0.0.1:${address.port}` } }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  forwarded.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(forwarded);
});
await new Promise((resolve, reject) => {
  secure.once('error', reject);
  secure.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
});
const port = secure.address().port;
const invite = coordinator.issueInvite({ ownerId, authorization });
process.stdout.write(JSON.stringify({ port, origin: `https://127.0.0.1:${port}`, inviteCode: invite.inviteCode,
  ownerAuthorization: authorization }) + '\n');
process.on('SIGTERM', async () => {
  secure.closeAllConnections();
  await new Promise(resolve => secure.close(resolve));
  await server.stop();
  process.exit(0);
});
