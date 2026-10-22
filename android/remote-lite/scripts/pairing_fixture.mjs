import { randomBytes } from 'node:crypto';
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
const invite = coordinator.issueInvite({ ownerId, authorization });
process.stdout.write(JSON.stringify({ port: address.port, inviteCode: invite.inviteCode,
  ownerAuthorization: authorization }) + '\n');
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
