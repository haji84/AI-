import { createHash } from 'node:crypto';
import { parseWebRtcSignal } from './manual-protocol.mjs';
import { RemoteLitePairingRegistry } from './device-pairing.mjs';
import { ManualRemoteSessionStore, RemoteLiteSessionError } from './manual-session.mjs';

/**
 * No network endpoints, OS screen capture or device input are started here.
 * authorizeOwner MUST verify an independent authenticated session and MUST NOT
 * accept request-submitted owner IDs as identity evidence. Signed device proofs
 * are checked before device acceptance and WebRTC signal handling.
 */
export class ManualRemoteCoordinator {
  #pairing;
  #sessions;
  #authorizeOwner;
  #deviceOwners = new Map();

  constructor({ authorizeOwner, now = () => Date.now(), initialDevices = [], persistDevices } = {}) {
    if (typeof authorizeOwner !== 'function') throw new TypeError('Independent owner authentication is required');
    this.#authorizeOwner = authorizeOwner;
    this.#pairing = new RemoteLitePairingRegistry({ authorizeOwner, now, initialDevices, persistDevices });
    for (const record of initialDevices) this.#deviceOwners.set(record.deviceId, record.ownerId);
    this.#sessions = new ManualRemoteSessionStore({
      now,
      authenticateViewer: ({ viewerId, deviceId }) => this.#pairing.ownsDevice({ ownerId: viewerId, deviceId }),
      authenticateDevice: ({ deviceId, devicePrincipalId }) => this.#pairing.isAuthorizedDevice({
        ownerId: this.#deviceOwners.get(deviceId), deviceId, devicePrincipalId,
      }),
    });
  }

  #owner(ownerId, authorization, action) {
    this.#pairing.assertHealthy();
    if (typeof ownerId !== 'string' || this.#authorizeOwner({ ownerId, authorization, action }) !== true) {
      throw new RemoteLiteSessionError('OWNER_NOT_AUTHORIZED');
    }
  }

  issueInvite({ ownerId, authorization } = {}) {
    this.#owner(ownerId, authorization, 'issue-invite');
    return this.#pairing.issueInvite({ ownerId, authorization });
  }

  proposeDevice(input) { return this.#pairing.propose(input); }
  proveDeviceEnrollment(input) { return this.#pairing.prove(input); }
  listDevices(input) { return this.#pairing.list(input); }

  approveDevice({ ownerId, authorization, requestId, expectedFingerprint } = {}) {
    this.#owner(ownerId, authorization, 'approve-device');
    const result = this.#pairing.approve({ ownerId, authorization, requestId, expectedFingerprint });
    this.#deviceOwners.set(result.deviceId, ownerId);
    return result;
  }

  challengeDevice(input = {}) {
    if (!this.#deviceOwners.has(input.deviceId)) throw new RemoteLiteSessionError('DEVICE_UNAVAILABLE');
    if (input.operation === 'session-discover') throw new RemoteLiteSessionError('DEVICE_UNAVAILABLE');
    this.#sessions.challengeableDevice(input);
    return this.#pairing.challengeDevice(input);
  }

  discoverPendingSession({ deviceId, proof } = {}) {
    if (!proof || proof.deviceId !== deviceId) throw new RemoteLiteSessionError('DEVICE_PROOF_REQUIRED');
    const principal = this.#pairing.verifyDiscovery(proof);
    return this.#sessions.pendingForDevice({ deviceId, devicePrincipalId: principal.devicePrincipalId });
  }

  discoverActiveSession({ deviceId, proof } = {}) {
    if (!proof || proof.deviceId !== deviceId) throw new RemoteLiteSessionError('DEVICE_PROOF_REQUIRED');
    const principal = this.#pairing.verifyDiscovery(proof);
    return this.#sessions.activeForDevice({ deviceId, devicePrincipalId: principal.devicePrincipalId });
  }

  startSession({ ownerId, authorization, deviceId } = {}) {
    this.#owner(ownerId, authorization, 'start-session');
    if (!this.#pairing.ownsDevice({ ownerId, deviceId })) throw new RemoteLiteSessionError('DEVICE_NOT_OWNED');
    return this.#sessions.request({ viewerId: ownerId, deviceId });
  }

  acceptSession({ sessionId, deviceId, proof } = {}) {
    const principal = this.#requireProof('session-accept', sessionId, deviceId, proof);
    return this.#sessions.accept({ sessionId, deviceId, devicePrincipalId: principal.devicePrincipalId });
  }

  viewerSignal({ ownerId, authorization, sessionId, viewerToken, signal } = {}) {
    this.#owner(ownerId, authorization, 'signal');
    return this.#sessions.signal({ sessionId, from: 'viewer', identityId: ownerId, viewerToken, signal });
  }

  deviceSignal({ sessionId, deviceId, proof, signal } = {}) {
    const validated = parseWebRtcSignal(signal);
    const payloadHash = createHash('sha256').update(JSON.stringify(validated)).digest('hex');
    if (proof?.payloadHash !== payloadHash) throw new RemoteLiteSessionError('SIGNAL_BINDING_INVALID');
    const principal = this.#requireProof('signal-send', sessionId, deviceId, proof);
    return this.#sessions.signal({ sessionId, from: 'device', identityId: principal.devicePrincipalId, signal: validated });
  }

  receiveSignalsForDevice({ sessionId, deviceId, proof, ack } = {}) {
    const principal = this.#requireProof('signal-receive', sessionId, deviceId, proof);
    return this.#sessions.receiveSignals({ sessionId, as: 'device', identityId: principal.devicePrincipalId, ack });
  }

  receiveSignalsForViewer({ ownerId, authorization, sessionId, viewerToken, ack } = {}) {
    this.#owner(ownerId, authorization, 'signal');
    return this.#sessions.receiveSignals({ sessionId, as: 'viewer', identityId: ownerId, viewerToken, ack });
  }

  manualInput({ ownerId, authorization, sessionId, viewerToken, sequence, command } = {}) {
    this.#owner(ownerId, authorization, 'manual-input');
    return this.#sessions.input({ sessionId, viewerId: ownerId, viewerToken, sequence, command });
  }

  viewerStatus({ ownerId, authorization, sessionId, viewerToken } = {}) {
    this.#owner(ownerId, authorization, 'view-status');
    return this.#sessions.status({ sessionId, viewerId: ownerId, viewerToken });
  }

  deviceStatus({ sessionId, deviceId, proof } = {}) {
    const principal = this.#requireProof('session-status', sessionId, deviceId, proof);
    return this.#sessions.deviceStatus({ sessionId, deviceId, devicePrincipalId: principal.devicePrincipalId });
  }

  endSession({ ownerId, authorization, sessionId, viewerToken } = {}) {
    this.#owner(ownerId, authorization, 'end-session');
    return this.#sessions.close({ sessionId, as: 'viewer', identityId: ownerId, viewerToken });
  }

  endSessionFromDevice({ sessionId, deviceId, proof } = {}) {
    const principal = this.#requireProof('session-end', sessionId, deviceId, proof);
    return this.#sessions.close({ sessionId, as: 'device', identityId: principal.devicePrincipalId });
  }

  revokeDevice({ ownerId, authorization, deviceId } = {}) {
    this.#owner(ownerId, authorization, 'revoke-device');
    const result = this.#pairing.revoke({ ownerId, authorization, deviceId });
    this.#deviceOwners.delete(deviceId);
    // Invalidate the local session before another controller can reconnect.
    // A future transport must also terminate active WebRTC tracks and channels.
    this.#sessions.invalidateDevice({ deviceId });
    return result;
  }

  #requireProof(operation, sessionId, deviceId, proof) {
    if (!proof || proof.operation !== operation || proof.sessionId !== sessionId || proof.deviceId !== deviceId) {
      throw new RemoteLiteSessionError('DEVICE_PROOF_REQUIRED');
    }
    return this.#pairing.verifyDevice(proof);
  }
}
