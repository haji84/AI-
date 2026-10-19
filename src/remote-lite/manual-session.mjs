import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { parseManualInput, parseWebRtcSignal, RemoteLiteProtocolError } from './manual-protocol.mjs';

const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9._:-]+$/u.test(value);
const digest = (token) => createHash('sha256').update(token).digest();

export class RemoteLiteSessionError extends Error {
  constructor(code) { super(code); this.name = 'RemoteLiteSessionError'; this.code = code; }
}
const fail = (code) => { throw new RemoteLiteSessionError(code); };

/**
 * In-memory, fail-closed reference implementation for manual sessions and WebRTC signaling.
 * No listener, network connection, device operation, account creation or credential persistence.
 *
 * authenticateViewer / authenticateDevice MUST be implemented by an independent authenticated
 * transport and MUST never trust request-supplied owner, device, or identity assertions.
 * Sessions are intentionally non-resumable after process restart. Durable pairing belongs to a
 * separately reviewed, authenticated provisioning service.
 */
export class ManualRemoteSessionStore {
  #sessions = new Map();
  #deviceToSession = new Map();

  constructor({ authenticateViewer, authenticateDevice, now = () => Date.now(), pendingMs = 60_000, idleMs = 10 * 60_000, maxMs = 30 * 60_000, maxSessions = 100, maxInputsPerSecond = 30 } = {}) {
    if (typeof authenticateViewer !== 'function' || typeof authenticateDevice !== 'function' || typeof now !== 'function') {
      throw new TypeError('Independent authenticated viewer/device authorization callbacks are required');
    }
    if (![pendingMs, idleMs, maxMs].every(v => Number.isInteger(v) && v >= 1000 && v <= 60 * 60_000)) throw new TypeError('Invalid session time limits');
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 100 ||
        !Number.isInteger(maxInputsPerSecond) || maxInputsPerSecond < 1 || maxInputsPerSecond > 60) throw new TypeError('Invalid resource limits');
    this.maxSessions = maxSessions;
    this.maxInputsPerSecond = maxInputsPerSecond;
    this.authenticateViewer = authenticateViewer;
    this.authenticateDevice = authenticateDevice;
    this.now = now;
    this.pendingMs = pendingMs;
    this.idleMs = idleMs;
    this.maxMs = maxMs;
  }

  #purge() {
    const t = this.now();
    for (const [id, s] of this.#sessions) {
      if (t >= s.expiresAt || t >= s.absoluteExpiresAt) {
        this.#sessions.delete(id);
        if (this.#deviceToSession.get(s.deviceId) === id) this.#deviceToSession.delete(s.deviceId);
      }
    }
  }

  #session(sessionId) {
    this.#purge();
    const s = this.#sessions.get(sessionId);
    if (!s) return fail('SESSION_NOT_FOUND_OR_EXPIRED');
    return s;
  }

  #viewer(s, viewerId, viewerToken) {
    if (!isId(viewerId) || s.viewerId !== viewerId || typeof viewerToken !== 'string' || viewerToken.length !== 64 ||
      !/^[0-9a-f]{64}$/u.test(viewerToken) || !timingSafeEqual(digest(viewerToken), s.viewerTokenHash) ||
      this.authenticateViewer({ viewerId, deviceId: s.deviceId }) !== true) return fail('VIEWER_NOT_AUTHORIZED');
  }

  #device(s, deviceId, devicePrincipalId) {
    if (!isId(deviceId) || !isId(devicePrincipalId) || s.deviceId !== deviceId ||
      this.authenticateDevice({ deviceId, devicePrincipalId }) !== true) return fail('DEVICE_NOT_AUTHORIZED');
  }

  request({ viewerId, deviceId } = {}) {
    if (!isId(viewerId) || !isId(deviceId) || this.authenticateViewer({ viewerId, deviceId }) !== true) return fail('VIEWER_NOT_AUTHORIZED');
    this.#purge();
    if (this.#deviceToSession.has(deviceId)) return fail('DEVICE_ALREADY_CONTROLLED');
    if (this.#sessions.size >= this.maxSessions) return fail('SESSION_CAPACITY_REACHED');
    const id = randomUUID();
    const viewerToken = randomBytes(32).toString('hex');
    const t = this.now();
    const s = { id, viewerId, deviceId, status: 'pending', viewerTokenHash: digest(viewerToken),
      expiresAt: t + this.pendingMs, absoluteExpiresAt: t + this.maxMs, nextSequence: 1, inputWindowAt: t, inputWindowCount: 0,
      fromViewer: [], fromDevice: [] };
    this.#sessions.set(id, s);
    this.#deviceToSession.set(deviceId, id);
    return { sessionId: id, viewerToken, status: 'pending', expiresAt: s.expiresAt };
  }

  accept({ sessionId, deviceId, devicePrincipalId } = {}) {
    const s = this.#session(sessionId);
    this.#device(s, deviceId, devicePrincipalId);
    if (s.status !== 'pending') return fail('SESSION_NOT_PENDING');
    if (this.authenticateViewer({ viewerId: s.viewerId, deviceId: s.deviceId }) !== true) return fail('VIEWER_NOT_AUTHORIZED');
    s.status = 'active';
    s.devicePrincipalId = devicePrincipalId;
    s.expiresAt = Math.min(this.now() + this.idleMs, s.absoluteExpiresAt);
    return { sessionId: s.id, deviceId: s.deviceId, status: s.status, expiresAt: s.expiresAt };
  }

  /** The downstream authenticated transport must never reissue a failed/uncertain input. */
  input({ sessionId, viewerId, viewerToken, sequence, command } = {}) {
    const s = this.#session(sessionId);
    this.#viewer(s, viewerId, viewerToken);
    if (s.status !== 'active') return fail('SESSION_NOT_ACTIVE');
    this.#device(s, s.deviceId, s.devicePrincipalId);
    if (!Number.isSafeInteger(sequence) || sequence !== s.nextSequence) return fail('INPUT_SEQUENCE_INVALID');
    // A refused command never reaches the transport. No execution is performed here.
    const validated = parseManualInput(command);
    const t = this.now();
    if (t - s.inputWindowAt >= 1000) { s.inputWindowAt = t; s.inputWindowCount = 0; }
    if (s.inputWindowCount >= this.maxInputsPerSecond) return fail('INPUT_RATE_LIMITED');
    s.inputWindowCount += 1;
    s.nextSequence += 1;
    s.expiresAt = Math.min(this.now() + this.idleMs, s.absoluteExpiresAt);
    return { sessionId: s.id, deviceId: s.deviceId, sequence, command: validated };
  }

  signal({ sessionId, from, identityId, viewerToken, signal } = {}) {
    const s = this.#session(sessionId);
    if (s.status !== 'active') return fail('SESSION_NOT_ACTIVE');
    this.#device(s, s.deviceId, s.devicePrincipalId);
    if (from === 'viewer') this.#viewer(s, identityId, viewerToken);
    else if (from === 'device') this.#device(s, s.deviceId, identityId);
    else return fail('UNKNOWN_PEER');
    const valid = parseWebRtcSignal(signal);
    if ((valid.type === 'offer' && from !== 'viewer') || (valid.type === 'answer' && from !== 'device')) return fail('SIGNAL_DIRECTION_INVALID');
    const queue = from === 'viewer' ? s.fromViewer : s.fromDevice;
    // Do not retain unbounded SDP/ICE messages from malicious peers.
    if (queue.length >= 64) return fail('SIGNAL_QUEUE_FULL');
    queue.push(valid);
    return { queued: true, sessionId: s.id };
  }

  receiveSignals({ sessionId, as, identityId, viewerToken } = {}) {
    const s = this.#session(sessionId);
    if (s.status !== 'active') return fail('SESSION_NOT_ACTIVE');
    this.#device(s, s.deviceId, s.devicePrincipalId);
    if (as === 'viewer') this.#viewer(s, identityId, viewerToken);
    else if (as === 'device') this.#device(s, s.deviceId, identityId);
    else return fail('UNKNOWN_PEER');
    const queue = as === 'viewer' ? s.fromDevice : s.fromViewer;
    return queue.splice(0, queue.length);
  }

  close({ sessionId, as, identityId, viewerToken } = {}) {
    const s = this.#session(sessionId);
    if (as === 'viewer') this.#viewer(s, identityId, viewerToken);
    else if (as === 'device') this.#device(s, s.deviceId, identityId);
    else return fail('UNKNOWN_PEER');
    this.#sessions.delete(s.id);
    this.#deviceToSession.delete(s.deviceId);
    return { sessionId: s.id, status: 'closed' };
  }

  /** Safe for status displays. Tokens, text, SDP, ICE and typed input are never returned. */
  status({ sessionId, viewerId, viewerToken } = {}) {
    const s = this.#session(sessionId);
    this.#viewer(s, viewerId, viewerToken);
    return { sessionId: s.id, deviceId: s.deviceId, status: s.status, expiresAt: s.expiresAt };
  }
}

export { RemoteLiteProtocolError };
