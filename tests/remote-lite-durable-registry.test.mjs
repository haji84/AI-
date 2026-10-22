import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ManualRemoteCoordinator } from '../src/remote-lite/manual-coordinator.mjs';
import { RemoteLitePairingRegistry } from '../src/remote-lite/device-pairing.mjs';

const principal = { ownerId: 'friend', authorization: 'test-owner' };
const authorizeOwner = p => p.ownerId === principal.ownerId && p.authorization === principal.authorization;
function enrollment(c) {
  const keys = generateKeyPairSync('ed25519');
  const invite = c.issueInvite(principal);
  const deviceId = 'test-windows';
  const request = c.proposeDevice({ inviteCode: invite.inviteCode, deviceId,
    publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }) });
  c.proveDeviceEnrollment({ requestId: request.requestId, signature: sign(null,
    Buffer.from(RemoteLitePairingRegistry.enrollmentMessage({ ...request, deviceId })), keys.privateKey).toString('base64') });
  return { keys, deviceId, requestId: request.requestId, expectedFingerprint: request.fingerprint };
}
function discover(c, d) {
  const p = { deviceId: d.deviceId, issuedAt: Date.now(), nonce: randomBytes(24).toString('hex') };
  return c.discoverPendingSession({ deviceId: d.deviceId, proof: { ...p, signature: sign(null,
    Buffer.from(RemoteLitePairingRegistry.discoveryMessage(p)), d.keys.privateKey).toString('base64') } });
}
test('durable owner-approved public identity survives restart; revoked identity stays revoked', () => {
  let stored = [];
  const c = new ManualRemoteCoordinator({ authorizeOwner, persistDevices: records => { stored = globalThis.structuredClone(records); } });
  const d = enrollment(c);
  assert.equal(c.listDevices(principal).pending[0].fingerprint, d.expectedFingerprint);
  assert.throws(() => c.listDevices({ ...principal, ownerId: 'other' }));
  c.approveDevice({ ...principal, ...d });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].publicKeyPem.includes('PRIVATE'), false);
  const restored = new ManualRemoteCoordinator({ authorizeOwner, initialDevices: stored,
    persistDevices: records => { stored = globalThis.structuredClone(records); } });
  assert.equal(restored.listDevices(principal).registered[0].deviceId, d.deviceId);
  assert.equal(discover(restored, d), null);
  const session = restored.startSession({ ...principal, deviceId: d.deviceId });
  assert.equal(discover(restored, d).sessionId, session.sessionId);
  restored.revokeDevice({ ...principal, deviceId: d.deviceId });
  assert.deepEqual(stored, []);
  assert.throws(() => discover(new ManualRemoteCoordinator({ authorizeOwner, initialDevices: stored }), d));
});
test('storage failure quarantines live authority rather than acknowledging an undurable approval/revoke', () => {
  for (const onRevoke of [false, true]) {
    let fail = false;
    const c = new ManualRemoteCoordinator({ authorizeOwner, persistDevices: () => { if (fail) throw Error('disk unavailable'); } });
    const d = enrollment(c);
    if (onRevoke) c.approveDevice({ ...principal, ...d });
    fail = true;
    assert.throws(() => onRevoke ? c.revokeDevice({ ...principal, deviceId: d.deviceId }) : c.approveDevice({ ...principal, ...d }));
    assert.throws(() => c.issueInvite(principal));
    assert.throws(() => discover(c, d));
  }
});
test('restore rejects corrupt/duplicate/extra records and asynchronous persistence fails closed', () => {
  for (const initialDevices of [{}, [{ ownerId: 'friend', deviceId: 'x', publicKeyPem: 'bad' }], new Array(101).fill({})]) {
    assert.throws(() => new ManualRemoteCoordinator({ authorizeOwner, initialDevices }));
  }
  const c = new ManualRemoteCoordinator({ authorizeOwner, persistDevices: () => Promise.resolve() });
  const d = enrollment(c);
  assert.throws(() => c.approveDevice({ ...principal, ...d }));
  assert.throws(() => c.listDevices(principal));
});
