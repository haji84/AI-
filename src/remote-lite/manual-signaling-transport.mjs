import { parseWebRtcSignal } from './manual-protocol.mjs';

export class ManualSignalingTransportError extends Error {
  constructor(code) { super(code); this.name = 'ManualSignalingTransportError'; this.code = code; }
}
const fail = code => { throw new ManualSignalingTransportError(code); };
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/u.test(value);
const validSignature = value => typeof value === 'string' && /^[A-Za-z0-9+/]{86}==$/u.test(value);
const challengeId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const hexNonce = value => typeof value === 'string' && /^[0-9a-f]{48}$/u.test(value);
const hexHash = async value => {
  if (!globalThis.crypto?.subtle) fail('SIGNAL_HASH_UNAVAILABLE');
  const bytes = new globalThis.TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** Connects one browser peer to an independently authenticated coordinator.
 * `post` must pin the HTTPS service and attach the owner's authenticated
 * session for a viewer. A host's `signMessage` must cross into a constrained
 * native device signer; never expose its private key to this module/page.
 * This adapter opens no network listener and does not establish RTC by itself. */
export function createManualSignalingTransport({ role, sessionId, deviceId, viewerToken, post, signMessage,
  now = () => Date.now() } = {}) {
  if (!['host', 'viewer'].includes(role) || !validId(sessionId) || typeof post !== 'function' ||
    typeof now !== 'function' ||
    (role === 'host' && (!validId(deviceId) || typeof signMessage !== 'function')) ||
    (role === 'viewer' && (typeof viewerToken !== 'string' || !/^[0-9a-f]{64}$/u.test(viewerToken)))) {
    fail('SIGNALING_CONFIG_INVALID');
  }
  const request = async (path, body) => {
    let response;
    try { response = await post(path, body); } catch { fail('SIGNALING_REFUSED'); }
    if (response?.status !== 200 || response.ok !== true) fail('SIGNALING_REFUSED');
    return response.result;
  };
  const proof = async (operation, payloadHash = '') => {
    const nonce = await request('/v1/device/challenge', { deviceId, sessionId, operation, payloadHash });
    if (!challengeId(nonce?.challengeId) || !hexNonce(nonce?.challenge) ||
      !Number.isSafeInteger(nonce?.expiresAt) || nonce.expiresAt <= now()) fail('SIGNALING_CHALLENGE_INVALID');
    const message = ['GORIQ_REMOTE_DEVICE_AUTH_V1', deviceId, operation, sessionId,
      nonce.challengeId, nonce.challenge, payloadHash].join('\n');
    let signature;
    try { signature = await signMessage(message); } catch { fail('SIGNALING_SIGNATURE_INVALID'); }
    if (!validSignature(signature)) fail('SIGNALING_SIGNATURE_INVALID');
    return { deviceId, operation, sessionId, challengeId: nonce.challengeId, payloadHash, signature };
  };
  let acknowledged = 0;
  let pendingCursor = 0;
  return Object.freeze({
    async send(signal) {
      const valid = parseWebRtcSignal(signal);
      if (role === 'viewer') {
        await request('/v1/viewer/signal', { sessionId, viewerToken, signal: valid });
      } else {
        const payloadHash = await hexHash(JSON.stringify(valid));
        await request('/v1/device/signal', { sessionId, deviceId, signal: valid,
          proof: await proof('signal-send', payloadHash) });
      }
    },
    async receive() {
      const received = role === 'viewer'
        ? await request('/v1/viewer/poll', { sessionId, viewerToken, ack: acknowledged })
        : await request('/v1/device/poll', { sessionId, deviceId, ack: acknowledged,
          proof: await proof('signal-receive') });
      if (!Number.isSafeInteger(received?.cursor) || received.cursor < acknowledged ||
        received.cursor > acknowledged + 1 || !Array.isArray(received.signals) || received.signals.length > 1 ||
        (received.signals.length === 1) !== (received.cursor === acknowledged + 1)) fail('SIGNALING_RESPONSE_INVALID');
      try {
        const valid = received.signals.map(parseWebRtcSignal);
        pendingCursor = received.cursor;
        return valid;
      }
      catch { fail('SIGNALING_RESPONSE_INVALID'); }
    },
    // Call only after the peer has applied the returned SDP/ICE. A failed
    // application leaves the message available for a retry or session close.
    acknowledge() { acknowledged = pendingCursor; },
  });
}
