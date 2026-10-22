import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { parseWebRtcSignal } from './manual-protocol.mjs';
import { RemoteLitePairingRegistry } from './device-pairing.mjs';
import { ManualRemoteSessionStore, RemoteLiteSessionError } from './manual-session.mjs';
import { isTurnUrl } from './turn-credentials.mjs';

const validIceServer = (server, expiresAt) => {
  if (!server || typeof server !== 'object' || Array.isArray(server) ||
      Object.keys(server).some(k => !['urls','username','credential'].includes(k)) ||
      !Array.isArray(server.urls) || server.urls.length < 1 || server.urls.length > 4 || !server.urls.every(isTurnUrl) ||
      typeof server.username !== 'string' || !/^[1-9][0-9]{0,12}:[a-f0-9]{32}$/u.test(server.username) ||
      Number(server.username.split(':')[0]) * 1000 !== expiresAt ||
      typeof server.credential !== 'string' || server.credential.length !== 28) return false;
  const decoded = Buffer.from(server.credential, 'base64');
  return decoded.length === 20 && decoded.toString('base64') === server.credential;
};

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
  #iceForSession;
  #ice = new Map();
  #now;

  constructor({ authorizeOwner, now = () => Date.now(), initialDevices = [], persistDevices,
    iceForSession = () => ({ iceServers: [], mode: 'direct-only' }) } = {}) {
    if (typeof authorizeOwner !== 'function') throw new TypeError('Independent owner authentication is required');
    if (typeof iceForSession !== 'function') throw new TypeError('Session ICE issuer required');
    this.#authorizeOwner = authorizeOwner;
    this.#iceForSession = iceForSession;
    this.#now = now;
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

  /** One-use, purpose-bound proof is required even for a cached credential.
   * No caller supplies the owner identity or the provider's shared secret. */
  deviceIce({ sessionId, deviceId, proof } = {}) {
    const principal = this.#requireProof('session-ice', sessionId, deviceId, proof);
    const active = this.#sessions.deviceStatus({ sessionId, deviceId, devicePrincipalId: principal.devicePrincipalId });
    if (active.status !== 'active') throw new RemoteLiteSessionError('SESSION_NOT_ACTIVE');
    const cached = this.#ice.get(sessionId);
    if (cached) {
      if (cached.value.expiresAt <= this.#now()) throw new RemoteLiteSessionError('ICE_CREDENTIALS_EXPIRED');
      return { ...globalThis.structuredClone(cached.value), serverTime: this.#now() };
    }
    // Remove really ended/expired sessions, not merely expired TURN entries:
    // an active session cannot mint another username after its ICE expires.
    for (const [id, entry] of this.#ice) {
      try {
        if (this.#sessions.deviceStatus({ sessionId: id, deviceId: entry.value.deviceId,
          devicePrincipalId: entry.principalId }).status === 'active') continue;
      } catch { /* No longer authorized. Drop only the in-memory credential. */ }
      this.#ice.delete(id);
    }
    if (this.#ice.size >= 100) throw new RemoteLiteSessionError('ICE_CAPACITY_REACHED');
    const ice = this.#iceForSession({ ownerId: this.#deviceOwners.get(deviceId), sessionId,
      sessionExpiresAt: active.expiresAt });
    const direct = ice?.mode === 'direct-only';
    const expiresAt = direct ? active.expiresAt : ice?.expiresAt;
    if (!ice || Object.keys(ice).some(k => !['iceServers','mode','expiresAt'].includes(k)) ||
        !Array.isArray(ice.iceServers) || ice.iceServers.length > 4 ||
        (direct ? ice.iceServers.length !== 0 : ice.mode !== 'turn-ephemeral-approved-provider' || ice.iceServers.length === 0) ||
        !Number.isSafeInteger(expiresAt) || expiresAt <= this.#now() || expiresAt > active.expiresAt ||
        (!direct && (expiresAt > this.#now() + 600000 || !ice.iceServers.every(s => validIceServer(s, expiresAt))))) {
      throw new RemoteLiteSessionError('ICE_UNAVAILABLE');
    }
    const value = globalThis.structuredClone({ sessionId, deviceId, iceServers: ice.iceServers, mode: ice.mode, expiresAt });
    if (!direct) this.#ice.set(sessionId, { value, principalId: principal.devicePrincipalId });
    return { ...globalThis.structuredClone(value), serverTime: this.#now() };
  }

  endSession({ ownerId, authorization, sessionId, viewerToken } = {}) {
    this.#owner(ownerId, authorization, 'end-session');
    const result = this.#sessions.close({ sessionId, as: 'viewer', identityId: ownerId, viewerToken });
    this.#ice.delete(sessionId);
    return result;
  }

  endSessionFromDevice({ sessionId, deviceId, proof } = {}) {
    const principal = this.#requireProof('session-end', sessionId, deviceId, proof);
    const result = this.#sessions.close({ sessionId, as: 'device', identityId: principal.devicePrincipalId });
    this.#ice.delete(sessionId);
    return result;
  }

  revokeDevice({ ownerId, authorization, deviceId } = {}) {
    this.#owner(ownerId, authorization, 'revoke-device');
    const result = this.#pairing.revoke({ ownerId, authorization, deviceId });
    this.#deviceOwners.delete(deviceId);
    // Invalidate the local session before another controller can reconnect.
    // A future transport must also terminate active WebRTC tracks and channels.
    this.#sessions.invalidateDevice({ deviceId });
    for (const [id, entry] of this.#ice) if (entry.value.deviceId === deviceId) this.#ice.delete(id);
    return result;
  }

  #requireProof(operation, sessionId, deviceId, proof) {
    if (!proof || proof.operation !== operation || proof.sessionId !== sessionId || proof.deviceId !== deviceId) {
      throw new RemoteLiteSessionError('DEVICE_PROOF_REQUIRED');
    }
    return this.#pairing.verifyDevice(proof);
  }
}
