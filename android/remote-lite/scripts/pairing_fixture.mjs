import { randomBytes } from 'node:crypto';
import { ManualRemoteCoordinator } from '../../../src/remote-lite/manual-coordinator.mjs';
import { createLoopbackSignaling } from '../../../src/remote-lite/loopback-signaling.mjs';

const ownerId = 'android-vm-owner';
const authorization = randomBytes(24).toString('hex');
const coordinator = new ManualRemoteCoordinator({
  authorizeOwner: ({ ownerId: candidate, authorization: supplied }) =>
    candidate === ownerId && supplied === authorization,
});
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
