import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { ManualRemoteCoordinator } from './manual-coordinator.mjs';
import { dispatchRemoteOperation } from './loopback-signaling.mjs';
import { RemoteOwnerAuth } from './owner-auth.mjs';

const fail = (code, status = 403) => { const e = new Error(code); e.code = code; e.status = status; throw e; };
const only = (p, keys) => {
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !keys.includes(k))) fail('INVALID_FIELDS', 400);
  return p;
};
const body = async req => {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail('JSON_REQUIRED', 415);
  if (req.headers['content-length'] && (!/^\d+$/u.test(req.headers['content-length']) || Number(req.headers['content-length']) > 98304)) fail('BODY_TOO_LARGE', 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; if (size > 98304) fail('BODY_TOO_LARGE', 413); chunks.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_JSON', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('INVALID_JSON', 400);
  return parsed;
};
const deviceRoutes = new Set(['propose','prove','challenge','accept','status','pending','active','signal','poll','end'].map(v => '/v1/device/' + v));
const apiRoutes = new Map([
  ['/api/invite', ['/v1/invite', []]], ['/api/approve', ['/v1/approve', ['requestId','expectedFingerprint']]],
  ['/api/revoke', ['/v1/revoke', ['deviceId']]],
  ['/api/viewer/signal', ['/v1/viewer/signal', ['sessionId','signal']]],
  ['/api/viewer/poll', ['/v1/viewer/poll', ['sessionId','ack']]],
  ['/api/viewer/status', ['/v1/viewer/status', ['sessionId']]],
  ['/api/viewer/end', ['/v1/viewer/end', ['sessionId']]],
]);
const staticFiles = new Map([
  ['/', ['owner-portal.html', 'text/html; charset=utf-8']],
  ['/portal.mjs', ['owner-portal-browser.mjs', 'text/javascript; charset=utf-8']],
  ['/portal.css', ['owner-portal.css', 'text/css; charset=utf-8']],
  ...['browser-webrtc.mjs','manual-protocol.mjs','device-signature-format.mjs'].map(v => ['/' + v, [v, 'text/javascript; charset=utf-8']]),
]);

/** HTTPS request handler. Caller must supply a real HTTPS server, exact public
 * origin, validated durable registry and configured owner key digests. No listener
 * or account starts on import. Native device protocol is unchanged. */
export function createOwnerPortal({ origin, owners, initialDevices = [], persistDevices,
  now = () => Date.now(), iceForSession = () => ({ iceServers: [], mode: 'direct-only' }) } = {}) {
  const parsed = new globalThis.URL(origin);
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password || typeof persistDevices !== 'function') throw new TypeError('Exact HTTPS origin and durable registry required');
  const ownerIds = new Set((owners || []).map(o => o.ownerId));
  if (initialDevices.some(d => !ownerIds.has(d.ownerId))) throw new TypeError('Registry owner missing from configuration');
  const cleanupAuthority = randomBytes(32).toString('hex');
  let coordinator;
  const auth = new RemoteOwnerAuth({ owners, now, onEnd: s => {
    for (const [sessionId, viewerToken] of s.connections) {
      try { coordinator.endSession({ ownerId: s.ownerId, authorization: cleanupAuthority, sessionId, viewerToken }); }
      catch { /* Already expired/revoked or quarantined; never reopen. */ }
    }
    s.connections.clear();
  } });
  coordinator = new ManualRemoteCoordinator({ initialDevices, persistDevices, now,
    authorizeOwner: p => ownerIds.has(p.ownerId) && (p.authorization === cleanupAuthority || auth.authorized(p)) });
  // Global fixed windows bound work/memory without trusting forwarded IP headers.
  let windowAt = now(), requestCount = 0, loginCount = 0;
  const timer = globalThis.setInterval(() => auth.expire(), 500); timer.unref?.();
  const headers = {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Strict-Transport-Security': 'max-age=31536000',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  const send = (res, status, value, extra = {}) => {
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(value));
  };
  const cookie = (token, age) => `__Host-remote-lite=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
  const handler = async (req, res) => {
    try {
      if (!req.socket.encrypted || req.headers.host !== parsed.host || req.headers['access-control-request-method']) fail('HTTPS_OR_HOST_REQUIRED');
      if (now() - windowAt >= 1000) { windowAt = now(); requestCount = 0; }
      if (++requestCount > 512) fail('RATE_LIMITED', 429);
      if (req.method === 'GET' && staticFiles.has(req.url)) {
        const [name, type] = staticFiles.get(req.url);
        res.writeHead(200, { ...headers, 'Content-Type': type });
        res.end(readFileSync(new globalThis.URL(name, import.meta.url))); return;
      }
      if (req.method !== 'POST' || typeof req.url !== 'string' || !/^[\w/-]+$/u.test(req.url)) fail('NOT_FOUND', 404);
      if (deviceRoutes.has(req.url)) {
        if (req.headers.origin || req.headers.cookie) fail('DEVICE_TRANSPORT_REQUIRED');
        auth.expire();
        const result = dispatchRemoteOperation(coordinator, req.url, await body(req), null);
        send(res, 200, { ok: true, result }); return;
      }
      if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) fail('ORIGIN_REQUIRED');
      if (req.url === '/api/login') {
        // A separate minute bucket prevents login floods; no account existence leak.
        const minute = Math.floor(now() / 60000);
        if (loginCount?.minute !== minute) loginCount = { minute, count: 0 };
        if (++loginCount.count > 30) fail('LOGIN_RATE_LIMITED', 429);
        const p = only(await body(req), ['key']);
        const login = auth.login(p.key);
        try { auth.logout(req.headers.cookie); } catch { /* No prior login. */ }
        send(res, 200, { ok: true, result: { ownerId: login.session.ownerId, csrf: login.session.csrf } }, { 'Set-Cookie': cookie(login.token, 43200) }); return;
      }
      const s = auth.read(req.headers.cookie, req.url !== '/api/viewer/poll' && req.url !== '/api/viewer/status');
      if (req.url === '/api/session') {
        only(await body(req), []);
        send(res, 200, { ok: true, result: { ownerId: s.ownerId, csrf: s.csrf } }); return;
      }
      if (req.headers['x-remote-csrf'] !== s.csrf) fail('CSRF_REQUIRED');
      const p = await body(req);
      if (req.url === '/api/logout') {
        only(p, []); auth.logout(req.headers.cookie);
        send(res, 200, { ok: true, result: { stopped: true } }, { 'Set-Cookie': cookie('', 0) }); return;
      }
      if (req.url === '/api/devices') {
        only(p, []); send(res, 200, { ok: true, result: coordinator.listDevices(s) }); return;
      }
      if (req.url === '/api/start') {
        only(p, ['deviceId']);
        const session = coordinator.startSession({ ...s, ...p });
        s.connections.set(session.sessionId, session.viewerToken);
        try {
          const ice = iceForSession({ ownerId: s.ownerId, sessionId: session.sessionId });
          if (!ice || !Array.isArray(ice.iceServers)) fail('ICE_UNAVAILABLE', 503);
          send(res, 200, { ok: true, result: { sessionId: session.sessionId, deviceId: p.deviceId,
            status: session.status, expiresAt: session.expiresAt, iceServers: ice.iceServers, connectionMode: ice.mode } });
        } catch (e) {
          coordinator.endSession({ ...s, sessionId: session.sessionId, viewerToken: session.viewerToken });
          s.connections.delete(session.sessionId); throw e;
        }
        return;
      }
      const route = apiRoutes.get(req.url);
      if (!route) fail('NOT_FOUND', 404);
      only(p, route[1]);
      if (req.url.startsWith('/api/viewer/')) {
        const viewerToken = s.connections.get(p.sessionId);
        if (!viewerToken) fail('CONNECTION_NOT_OWNED');
        p.viewerToken = viewerToken;
      }
      const result = dispatchRemoteOperation(coordinator, route[0], p, { ownerId: s.ownerId, authorization: s.authorization });
      if (req.url === '/api/viewer/end') s.connections.delete(p.sessionId);
      send(res, 200, { ok: true, result: req.url === '/api/invite'
        ? { ...result, invitation: 'goriqremote://enroll?server=' + encodeURIComponent(origin) + '&invite=' + result.inviteCode }
        : result });
    } catch (e) {
      const safe = e.status || ['OwnerAuthError','PairingError','RemoteLiteProtocolError','RemoteLiteSessionError','LocalSignalingError'].includes(e.name);
      send(res, e.status || (safe ? 403 : 500), { ok: false, code: safe ? e.code : 'INTERNAL_ERROR' });
    }
  };
  return { handler, close() { globalThis.clearInterval(timer); auth.close(); } };
}
