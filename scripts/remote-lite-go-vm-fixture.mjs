// Ephemeral cross-language fixture for the disposable Windows CI VM only.
// The generated device key is sent to the Go test over a local child-process
// pipe; it is never persisted, logged, or used as a production credential.
import { createInterface } from 'node:readline';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ManualRemoteCoordinator } from '../src/remote-lite/manual-coordinator.mjs';
import { RemoteLitePairingRegistry } from '../src/remote-lite/device-pairing.mjs';
import { createLoopbackSignaling } from '../src/remote-lite/loopback-signaling.mjs';

const ownerId = 'vm-owner';
const authorization = 'vm-test-owner';
const deviceId = 'windows-vm-go';
const coordinator = new ManualRemoteCoordinator({
  authorizeOwner: input => input.ownerId === ownerId && input.authorization === authorization,
});
const local = createLoopbackSignaling({
  coordinator,
  authenticateOwnerRequest: async request => request.headers.authorization === `Bearer ${authorization}`
    ? { ownerId, authorization } : null,
});
const keys = generateKeyPairSync('ed25519');
const signature = message => sign(null, Buffer.from(message), keys.privateKey).toString('base64');
const proof = (sessionId, operation) => {
  const challenge = coordinator.challengeDevice({ deviceId, sessionId, operation });
  const message = RemoteLitePairingRegistry.deviceMessage({ ...challenge, deviceId, sessionId, operation });
  return { ...challenge, deviceId, sessionId, operation, signature: signature(message) };
};

try {
  const invite = coordinator.issueInvite({ ownerId, authorization });
  const proposed = coordinator.proposeDevice({ inviteCode: invite.inviteCode, deviceId,
    publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }) });
  coordinator.proveDeviceEnrollment({ requestId: proposed.requestId,
    signature: signature(RemoteLitePairingRegistry.enrollmentMessage({ ...proposed, deviceId })) });
  coordinator.approveDevice({ ownerId, authorization, requestId: proposed.requestId,
    expectedFingerprint: proposed.fingerprint });
  const session = coordinator.startSession({ ownerId, authorization, deviceId });
  coordinator.acceptSession({ sessionId: session.sessionId, deviceId,
    proof: proof(session.sessionId, 'session-accept') });
  const bound = await local.start();
  process.stdout.write(JSON.stringify({ event: 'ready', url: `http://127.0.0.1:${bound.port}`,
    deviceId, sessionId: session.sessionId,
    privateKeyDer: keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') }) + '\n');
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (line === 'revoke') {
      coordinator.revokeDevice({ ownerId, authorization, deviceId });
      process.stdout.write(JSON.stringify({ event: 'revoked' }) + '\n');
    }
    if (line === 'exit') break;
  }
  await local.stop();
} catch (error) {
  process.stderr.write(`fixture failed: ${error?.stack || String(error)}\n`);
  await local.stop().catch(() => {});
  process.exitCode = 1;
}
