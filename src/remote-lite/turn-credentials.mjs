import { createHmac, createHash } from 'node:crypto';

/**
 * TURN REST credentials for a separately approved, operator-managed coturn.
 * Does not create accounts, listen on ports, or incur network usage.
 * Never return the long-lived shared secret to browsers.
 *
 * Coturn protocol: temporary username is expiryEpoch:opaquePrincipal,
 * credential is base64(HMAC-SHA1(username, sharedSecret)).
 */
export class TurnConfigError extends Error {
  constructor(code) { super(code); this.name = 'TurnConfigError'; this.code = code; }
}
const fault = c => { throw new TurnConfigError(c); };
export const isTurnUrl = value => {
  if (typeof value !== 'string' || value.length > 256 || value.includes('..')) return false;
  const match = /^turns?:[a-zA-Z0-9.-]+(?::([0-9]{1,5}))?(?:\?transport=(?:udp|tcp))?$/u.exec(value);
  return Boolean(match && (match[1] === undefined || (Number(match[1]) >= 1 && Number(match[1]) <= 65535)));
};
const validateConfig = (sharedSecret, urls) => {
  if (typeof sharedSecret !== 'string' || sharedSecret.length < 32 || sharedSecret.length > 512) fault('TURN_SECRET_UNAVAILABLE');
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 4 || !urls.every(isTurnUrl)) fault('TURN_URLS_INVALID');
};

export function issueTurnCredentials({ sharedSecret, urls, principalId, sessionId, authorize,
  now = () => Date.now(), ttlSeconds = 300 } = {}) {
  if (typeof authorize !== 'function' || authorize({ principalId, sessionId }) !== true) fault('TURN_NOT_AUTHORIZED');
  validateConfig(sharedSecret, urls);
  if (typeof principalId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(principalId) ||
    typeof sessionId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(sessionId)) fault('TURN_PRINCIPAL_INVALID');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 600) fault('TURN_TTL_INVALID');
  const current = now();
  if (!Number.isFinite(current) || current < 0) fault('TURN_TIME_INVALID');
  const expiresAt = Math.floor(current / 1000) + ttlSeconds;
  const opaque = createHash('sha256').update(principalId + '\0' + sessionId).digest('hex').slice(0, 32);
  const username = expiresAt + ':' + opaque;
  const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
  return { iceServers: [{ urls: [...urls], username, credential }],
    expiresAt: expiresAt * 1000,
    mode: 'turn-ephemeral-approved-provider' };
}

/** Private server callback, invoked ONLY after the portal has authenticated the
 * owner and created a session for their approved device. Never expose as a raw
 * endpoint taking request-supplied owner/session IDs. No network access here. */
export function createPortalTurnIssuer({ sharedSecret, urls, now = () => Date.now() } = {}) {
  validateConfig(sharedSecret, urls);
  const approvedUrls = [...urls];
  return ({ ownerId, sessionId, sessionExpiresAt }) => {
    const issuedAt = now();
    let ttlSeconds = 600;
    if (sessionExpiresAt !== undefined) {
      if (!Number.isSafeInteger(sessionExpiresAt)) fault('TURN_SESSION_EXPIRING');
      ttlSeconds = Math.min(600, Math.floor(sessionExpiresAt / 1000) - Math.floor(issuedAt / 1000));
      if (ttlSeconds < 30) fault('TURN_SESSION_EXPIRING');
    }
    return issueTurnCredentials({ sharedSecret, urls: approvedUrls,
      principalId: ownerId, sessionId, now: () => issuedAt, ttlSeconds,
      authorize: p => p.principalId === ownerId && p.sessionId === sessionId });
  };
}

/** Separate hard deny-by-default cost and deployment readiness policy.
 * This does not provision or start TURN infrastructure. */
export function relayReadiness({ providerApproved, credentialsApproved, billingHardCapVerified,
  maxRelayGiB, deployedHealthVerified, authConfigured } = {}) {
  const missing = [];
  if (providerApproved !== true) missing.push('PROVIDER_APPROVAL');
  if (credentialsApproved !== true) missing.push('CREDENTIAL_APPROVAL');
  if (billingHardCapVerified !== true) missing.push('BILLING_HARD_CAP');
  if (!Number.isFinite(maxRelayGiB) || maxRelayGiB <= 0) missing.push('RELAY_BUDGET');
  if (deployedHealthVerified !== true) missing.push('LIVE_HEALTH');
  if (authConfigured !== true) missing.push('RELAY_AUTH');
  return { ready: missing.length === 0, missing };
}
