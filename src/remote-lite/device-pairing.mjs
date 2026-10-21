import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';

const validId = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(value);
const hexHash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { throw new PairingError(code); };
const operations = new Set(['session-accept', 'session-status', 'session-discover', 'signal-send', 'signal-receive', 'session-end', 'reconnect']);
const token = () => randomBytes(24).toString('hex');
const bytesOfSignature = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value)) fail('SIGNATURE_INVALID');
  const data = Buffer.from(value, 'base64');
  if (data.length !== 64 || data.toString('base64') !== value) fail('SIGNATURE_INVALID');
  return data;
};
const loadKey = (pem) => {
  if (typeof pem !== 'string' || pem.length > 1024 || !pem.startsWith('-----BEGIN PUBLIC KEY-----')) fail('DEVICE_KEY_INVALID');
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') fail('DEVICE_KEY_INVALID');
    return { key, fingerprint: hexHash(key.export({ type: 'spki', format: 'der' })) };
  } catch { fail('DEVICE_KEY_INVALID'); }
};

export class PairingError extends Error {
  constructor(code) { super(code); this.name = 'PairingError'; this.code = code; }
}

/** A non-networked enrollment authority. Owner authorization must come from an
 * independently authenticated host session; caller supplied IDs are never proof.
 * Public network exposure, account login and durable secrets are out of scope. */
export class RemoteLitePairingRegistry {
  #invites = new Map();
  #pending = new Map();
  #devices = new Map();
  #challenges = new Map();

  constructor({ authorizeOwner, now = () => Date.now(), inviteMs = 5 * 60_000, proofMs = 60_000, limit = 100 } = {}) {
    if (typeof authorizeOwner !== 'function' || typeof now !== 'function') throw new TypeError('An independent owner authorization function and clock are required');
    if (![inviteMs, proofMs].every(n => Number.isInteger(n) && n >= 1000 && n <= 10 * 60_000) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid pairing bounds');
    this.authorizeOwner = authorizeOwner;
    this.now = now;
    this.inviteMs = inviteMs;
    this.proofMs = proofMs;
    this.limit = limit;
  }

  #prune() {
    const t = this.now();
    for (const [k, v] of this.#invites) if (t >= v.expiresAt) this.#invites.delete(k);
    for (const [k, v] of this.#pending) if (t >= v.expiresAt) this.#pending.delete(k);
    for (const [k, v] of this.#challenges) if (t >= v.expiresAt) this.#challenges.delete(k);
  }

  #owner(ownerId, authorization, action) {
    if (!validId(ownerId) || this.authorizeOwner({ ownerId, authorization, action }) !== true) fail('OWNER_NOT_AUTHORIZED');
  }

  issueInvite({ ownerId, authorization } = {}) {
    this.#owner(ownerId, authorization, 'issue-invite');
    this.#prune();
    if (this.#invites.size + this.#pending.size >= this.limit) fail('PAIRING_CAPACITY_REACHED');
    const inviteCode = token();
    const expiresAt = this.now() + this.inviteMs;
    this.#invites.set(hexHash(inviteCode), { ownerId, expiresAt });
    return { inviteCode, expiresAt };
  }

  /** One invite proposes one device. The device must prove its private key before
   * the owner can approve a displayed fingerprint. */
  propose({ inviteCode, deviceId, publicKeyPem } = {}) {
    this.#prune();
    if (typeof inviteCode !== 'string' || !/^[a-f0-9]{48}$/.test(inviteCode) || !validId(deviceId)) fail('INVITE_INVALID');
    const inviteKey = hexHash(inviteCode);
    const invite = this.#invites.get(inviteKey);
    if (!invite) fail('INVITE_INVALID');
    if (this.#devices.has(deviceId) || [...this.#pending.values()].some(p => p.deviceId === deviceId)) fail('DEVICE_ALREADY_REGISTERED');
    const { key, fingerprint } = loadKey(publicKeyPem);
    this.#invites.delete(inviteKey);
    const requestId = randomUUID();
    const challenge = token();
    const expiresAt = Math.min(invite.expiresAt, this.now() + this.proofMs);
    this.#pending.set(requestId, { ...invite, deviceId, key, fingerprint, challenge, expiresAt, proven: false });
    return { requestId, challenge, fingerprint, expiresAt };
  }

  static enrollmentMessage({ requestId, deviceId, fingerprint, challenge }) {
    return ['GORIQ_REMOTE_DEVICE_ENROLL_V1',requestId,deviceId,fingerprint,challenge].join('\n');
  }

  prove({ requestId, signature } = {}) {
    this.#prune();
    const pending = this.#pending.get(requestId);
    if (!pending) fail('PAIRING_EXPIRED_OR_NOT_FOUND');
    if (pending.proven) fail('PROOF_ALREADY_USED');
    const message = RemoteLitePairingRegistry.enrollmentMessage({ requestId, deviceId: pending.deviceId, fingerprint: pending.fingerprint, challenge: pending.challenge });
    if (!verify(null, Buffer.from(message), pending.key, bytesOfSignature(signature))) fail('DEVICE_PROOF_INVALID');
    pending.proven = true;
    pending.challenge = null;
    return { requestId, deviceId: pending.deviceId, fingerprint: pending.fingerprint, status: 'awaiting-owner-approval' };
  }

  approve({ ownerId, authorization, requestId, expectedFingerprint } = {}) {
    this.#owner(ownerId, authorization, 'approve-device');
    this.#prune();
    const pending = this.#pending.get(requestId);
    if (!pending || pending.ownerId !== ownerId || !pending.proven) fail('PAIRING_NOT_APPROVABLE');
    if (pending.fingerprint !== expectedFingerprint) fail('FINGERPRINT_MISMATCH');
    if (this.#devices.has(pending.deviceId)) fail('DEVICE_ALREADY_REGISTERED');
    if (this.#devices.size >= this.limit) fail('PAIRING_CAPACITY_REACHED');
    this.#devices.set(pending.deviceId, { ownerId, key: pending.key, fingerprint: pending.fingerprint });
    this.#pending.delete(requestId);
    return { deviceId: pending.deviceId, fingerprint: pending.fingerprint, status: 'registered' };
  }

  /** Challenge can be delivered over an untrusted transport; no authority is
   * granted until the signed, nonce-bound response is verified. */
  challengeDevice({ deviceId, operation, sessionId, payloadHash = '' } = {}) {
    this.#prune();
    const ownerId = this.#devices.get(deviceId)?.ownerId;
    if (!validId(deviceId) || !validId(sessionId) || !operations.has(operation) || !ownerId) fail('DEVICE_UNAVAILABLE');
    if ((operation === 'signal-send' && !/^[0-9a-f]{64}$/.test(payloadHash)) || (operation !== 'signal-send' && payloadHash !== '')) fail('SIGNAL_BINDING_INVALID');
    if ([...this.#challenges.values()].filter(record => record.deviceId === deviceId).length >= Math.min(8, this.limit)) {
      fail('CHALLENGE_DEVICE_CAPACITY_REACHED');
    }
    if ([...this.#challenges.values()].filter(record => record.ownerId === ownerId).length >= Math.min(16, this.limit * 2)) {
      fail('CHALLENGE_OWNER_CAPACITY_REACHED');
    }
    if (this.#challenges.size >= this.limit * 2) fail('CHALLENGE_CAPACITY_REACHED');
    const challenge = token();
    const challengeId = randomUUID();
    const expiresAt = this.now() + this.proofMs;
    this.#challenges.set(challengeId, { ownerId, deviceId, operation, sessionId, payloadHash, challenge, expiresAt });
    return { challengeId, challenge, expiresAt };
  }

  static deviceMessage({ deviceId, operation, sessionId, challengeId, challenge, payloadHash = '' }) {
    return ['GORIQ_REMOTE_DEVICE_AUTH_V1',deviceId,operation,sessionId,challengeId,challenge,payloadHash].join('\n');
  }

  verifyDevice({ deviceId, operation, sessionId, challengeId, payloadHash = '', signature } = {}) {
    this.#prune();
    const record = this.#challenges.get(challengeId);
    if (record) this.#challenges.delete(challengeId);
    if (!record || record.deviceId !== deviceId || record.operation !== operation || record.sessionId !== sessionId || record.payloadHash !== payloadHash) fail('CHALLENGE_NOT_FOUND_OR_MISMATCH');
    const device = this.#devices.get(deviceId);
    if (!device) fail('DEVICE_REVOKED');
    const message = RemoteLitePairingRegistry.deviceMessage({ ...record, challengeId });
    if (!verify(null, Buffer.from(message), device.key, bytesOfSignature(signature))) fail('DEVICE_PROOF_INVALID');
    return { ownerId: device.ownerId, deviceId, devicePrincipalId: device.fingerprint, operation, sessionId };
  }

  ownsDevice({ ownerId, deviceId } = {}) {
    return Boolean(validId(ownerId) && validId(deviceId) && this.#devices.get(deviceId)?.ownerId === ownerId);
  }

  isAuthorizedDevice({ ownerId, deviceId, devicePrincipalId } = {}) {
    const stored = this.#devices.get(deviceId);
    return Boolean(stored && stored.ownerId === ownerId && stored.fingerprint === devicePrincipalId);
  }

  revoke({ ownerId, authorization, deviceId } = {}) {
    this.#owner(ownerId, authorization, 'revoke-device');
    const stored = this.#devices.get(deviceId);
    if (!stored || stored.ownerId !== ownerId) fail('DEVICE_NOT_FOUND');
    this.#devices.delete(deviceId);
    for (const [k, c] of this.#challenges) if (c.deviceId === deviceId) this.#challenges.delete(k);
    return { deviceId, status: 'revoked' };
  }
}
