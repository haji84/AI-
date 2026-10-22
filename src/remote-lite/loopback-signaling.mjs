import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { ManualRemoteCoordinator } from './manual-coordinator.mjs';

/**
 * Loopback-only, JSON-over-HTTP adapter for native integration tests.
 *
 * NOT a public HTTPS signaling service, TURN relay, browser UI, nor media/input
 * transport. Authentication is an obligatory host-supplied callback; identity
 * is NEVER taken from the submitted JSON body. The caller can only bind this
 * server to IPv4 loopback. No server starts on import.
 */
const MAX_BYTES = 96 * 1024;
const OWNER_PATHS = new Set([
  '/v1/invite', '/v1/approve', '/v1/start', '/v1/viewer/signal',
  '/v1/viewer/poll', '/v1/viewer/status', '/v1/viewer/end', '/v1/revoke',
]);
const DEVICE_PATHS = new Set([
  '/v1/device/propose', '/v1/device/prove', '/v1/device/challenge',
  '/v1/device/accept', '/v1/device/status', '/v1/device/ice', '/v1/device/pending', '/v1/device/active', '/v1/device/signal', '/v1/device/poll', '/v1/device/end',
]);
const safeResponse = (res, status, value) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'",
  });
  res.end(JSON.stringify(value));
};
const json = async (req) => {
  const sizeHeader = req.headers['content-length'];
  if (sizeHeader !== undefined && (!/^\d+$/.test(sizeHeader) || Number(sizeHeader) > MAX_BYTES)) {
    throw new LocalSignalingError('BODY_TOO_LARGE', 413);
  }
  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new LocalSignalingError('JSON_REQUIRED', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new LocalSignalingError('BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new LocalSignalingError('INVALID_JSON', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LocalSignalingError('OBJECT_REQUIRED', 400);
  return value;
};
const only = (obj, names) => {
  if (Object.keys(obj).some(k => !names.includes(k))) throw new LocalSignalingError('UNKNOWN_FIELD', 400);
  return obj;
};
export class LocalSignalingError extends Error {
  constructor(code, httpStatus = 400) { super(code); this.code = code; this.httpStatus = httpStatus; }
}
// Shared strict operation dispatcher. Transport authentication stays mandatory
// in each adapter; exporting this function does not start a listener.
export const dispatchRemoteOperation = (c, path, p, principal) => {
  const o = principal || {};
  switch (path) {
    case '/v1/invite': return c.issueInvite({ ...o, ...only(p, []) });
    case '/v1/approve': return c.approveDevice({ ...o, ...only(p, ['requestId', 'expectedFingerprint']) });
    case '/v1/start': return c.startSession({ ...o, ...only(p, ['deviceId']) });
    case '/v1/viewer/signal': return c.viewerSignal({ ...o, ...only(p, ['sessionId', 'viewerToken', 'signal']) });
    case '/v1/viewer/poll': return c.receiveSignalsForViewer({ ...o, ...only(p, ['sessionId', 'viewerToken', 'ack']) });
    case '/v1/viewer/status': return c.viewerStatus({ ...o, ...only(p, ['sessionId', 'viewerToken']) });
    case '/v1/viewer/end': return c.endSession({ ...o, ...only(p, ['sessionId', 'viewerToken']) });
    case '/v1/revoke': return c.revokeDevice({ ...o, ...only(p, ['deviceId']) });
    case '/v1/device/propose': return c.proposeDevice(only(p, ['inviteCode', 'deviceId', 'publicKeyPem']));
    case '/v1/device/prove': return c.proveDeviceEnrollment(only(p, ['requestId', 'signature']));
    case '/v1/device/challenge': return c.challengeDevice(only(p, ['deviceId', 'operation', 'sessionId', 'payloadHash']));
    case '/v1/device/accept': return c.acceptSession(only(p, ['sessionId', 'deviceId', 'proof']));
    case '/v1/device/status': return c.deviceStatus(only(p, ['sessionId', 'deviceId', 'proof']));
    case '/v1/device/ice': return c.deviceIce(only(p, ['sessionId', 'deviceId', 'proof']));
    case '/v1/device/pending': return c.discoverPendingSession(only(p, ['deviceId', 'proof']));
    case '/v1/device/active': return c.discoverActiveSession(only(p, ['deviceId', 'proof']));
    case '/v1/device/signal': return c.deviceSignal(only(p, ['sessionId', 'deviceId', 'proof', 'signal']));
    case '/v1/device/poll': return c.receiveSignalsForDevice(only(p, ['sessionId', 'deviceId', 'proof', 'ack']));
    case '/v1/device/end': return c.endSessionFromDevice(only(p, ['sessionId', 'deviceId', 'proof']));
    default: throw new LocalSignalingError('NOT_FOUND', 404);
  }
};

/** Reject requests from unexpected origins and DNS rebinding before auth parsing. */
const safeRequest = (req, boundPort) => {
  const remote = req.socket.remoteAddress;
  if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') throw new LocalSignalingError('LOCAL_ONLY', 403);
  if (req.headers.host !== '127.0.0.1:' + boundPort) throw new LocalSignalingError('HOST_NOT_ALLOWED', 403);
  if (req.headers.origin || req.headers.cookie || req.headers['access-control-request-method']) throw new LocalSignalingError('BROWSER_ORIGIN_DENIED', 403);
  if (req.method !== 'POST' || typeof req.url !== 'string' || req.url.includes('?') || req.url.includes('#') || !/^[\w/-]+$/.test(req.url)) {
    throw new LocalSignalingError('ENDPOINT_NOT_ALLOWED', 404);
  }
  if (!OWNER_PATHS.has(req.url) && !DEVICE_PATHS.has(req.url)) throw new LocalSignalingError('ENDPOINT_NOT_ALLOWED', 404);
};

/** Returns a bounded local test server that is *incapable* of non-loopback binds.
 * authenticateOwnerRequest(req) must independently validate the transport and
 * return {ownerId, authorization}; it cannot echo client-supplied JSON identity.
 * Authorization itself is rechecked inside the injected ManualRemoteCoordinator.
 */
export function createLoopbackSignaling({ coordinator, authenticateOwnerRequest } = {}) {
  if (!(coordinator instanceof ManualRemoteCoordinator) || typeof authenticateOwnerRequest !== 'function') {
    throw new TypeError('A coordinator and independent HTTP owner authentication are required');
  }
  const server = createServer(async (req, res) => {
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new LocalSignalingError('NOT_LISTENING', 503);
      safeRequest(req, address.port);
      const principal = OWNER_PATHS.has(req.url) ? await authenticateOwnerRequest(req) : null;
      if (OWNER_PATHS.has(req.url) && (!principal || typeof principal.ownerId !== 'string' || typeof principal.authorization !== 'string')) {
        throw new LocalSignalingError('NOT_AUTHENTICATED', 401);
      }
      const payload = await json(req);
      const result = dispatchRemoteOperation(coordinator, req.url, payload, principal);
      safeResponse(res, 200, { ok: true, result });
    } catch (e) {
      const permitted = e instanceof LocalSignalingError || ['PairingError','RemoteLiteProtocolError','RemoteLiteSessionError'].includes(e?.name);
      safeResponse(res, e instanceof LocalSignalingError ? e.httpStatus : permitted ? 403 : 500,
        { ok: false, code: permitted ? e.code : 'INTERNAL_ERROR' });
    }
  });
  server.maxHeadersCount = 24;
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  return {
    async start(port = 0) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid local port');
      if (server.listening) throw new LocalSignalingError('ALREADY_LISTENING');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      return { hostname: '127.0.0.1', port: address.port, protocol: 'http', mode: 'local-test-only' };
    },
    async stop() {
      if (!server.listening) return;
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    },
  };
}
