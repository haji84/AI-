import { createServer } from 'node:https';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createOwnerPortal } from '../src/remote-lite/owner-portal.mjs';
import { openRemoteRegistry } from '../src/remote-lite/registry-file.mjs';
import { createPortalTurnIssuer, createPortalStunIssuer } from '../src/remote-lite/turn-credentials.mjs';
import { loadTLSFiles, installTLSReload } from '../src/remote-lite/tls-reload.mjs';
import { readGoriqHostedPortalConfig } from '../src/remote-lite/goriq-hosted-config.mjs';

// Operator command only. Friends use the HTTPS UI/APK/EXE. No production key is
// generated or printed; provision a distinct random owner key via approved means.
const [configPath, mode, ...extra] = process.argv.slice(2);
if (!configPath || extra.length || (mode && !['--initialize', '--goriq-friend'].includes(mode))) throw new Error('Usage: node scripts/remote-lite-owner-server.mjs <private-config.json> [--initialize | --goriq-friend]');
const hosted = mode === '--goriq-friend' ? readGoriqHostedPortalConfig(resolve(configPath)) : null;
if (hosted && (!process.connected || typeof process.send !== 'function')) throw Error('GORIQ_FRIEND_PARENT_REQUIRED');
const absolute = hosted ? hosted.configPath : resolve(configPath);
if (!hosted && lstatSync(absolute).size > 16384) throw new Error('Configuration too large');
const config = hosted ? hosted.config : JSON.parse(readFileSync(absolute, 'utf8'));
const allowed = ['origin','listenHost','listenPort','tlsCert','tlsKey','tlsServerName','stateDirectory','owners','turn','stun'];
if (!config || Object.keys(config).some(k => !allowed.includes(k)) ||
  typeof config.listenHost !== 'string' || !Number.isInteger(config.listenPort) || config.listenPort < 1 || config.listenPort > 65535) throw new Error('Explicit HTTPS listener configuration required');
const relative = p => { if (typeof p !== 'string' || !p) throw new Error('Path required'); return resolve(dirname(absolute), p); };
let iceForSession;
if (config.stun !== undefined) {
  if (config.turn !== undefined || !config.stun || typeof config.stun !== 'object' ||
      Array.isArray(config.stun) || Object.keys(config.stun).some(k => k !== 'urls')) throw new Error('Select one explicit ICE provider');
  iceForSession = createPortalStunIssuer(config.stun);
}
if (config.turn !== undefined) {
  const turn = config.turn;
  if (!turn || typeof turn !== 'object' || Array.isArray(turn) || Object.keys(turn).some(k => !['urls','sharedSecretFile'].includes(k))) throw new Error('Invalid TURN configuration');
  const secretPath = relative(turn.sharedSecretFile);
  if (lstatSync(secretPath).size > 512) throw new Error('TURN secret file too large');
  iceForSession = createPortalTurnIssuer({ urls: turn.urls, sharedSecret: readFileSync(secretPath, 'utf8').trim() });
}
const registry = openRemoteRegistry(relative(config.stateDirectory), { initialize: mode === '--initialize' });
let portal, server;
let ready = false, stopRequested = false, stopping = false;
const stop = () => {
  stopRequested = true;
  if (!ready || stopping) return;
  stopping = true;
  portal.close(); server.closeAllConnections(); server.close(() => {
    registry.close();
    if (hosted && process.connected) process.disconnect();
  });
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if (hosted) {
  // Register before the first await: a parent stop/disconnect during listen
  // must be remembered and applied as soon as the listener is ready.
  process.on('message', message => {
    if (message && !Array.isArray(message) && Object.keys(message).length === 1 && message.type === 'goriq-friend-stop') stop();
  });
  process.on('disconnect', stop);
  if (!process.connected) stop();
}
try {
  portal = createOwnerPortal({ origin: config.origin, owners: config.owners, iceForSession, ...registry });
  // Browsers behind an HTTPS proxy add forwarding headers. Bound both their
  // count and total bytes without changing Host, Origin or owner validation.
  const originName = new URL(config.origin).hostname.replace(/^\[|\]$/gu, '');
  const serverName = config.tlsServerName ?? originName;
  // An explicitly configured proxy can verify a distinct TLS name only on a
  // loopback origin listener. Host/Origin authorization stays at config.origin.
  if (serverName !== originName && !['127.0.0.1', '::1'].includes(config.listenHost)) throw Error('TLS_SERVER_NAME_INVALID');
  const tlsPaths = { certPath: relative(config.tlsCert), keyPath: relative(config.tlsKey), serverName };
  const tlsOptions = loadTLSFiles(tlsPaths);
  server = createServer({ ...tlsOptions, maxHeaderSize: 8192 }, portal.handler);
  installTLSReload(server, tlsPaths);
  server.maxHeadersCount = 48; server.headersTimeout = 10000; server.requestTimeout = 10000; server.maxConnections = 512;
  await new Promise((ok, no) => { server.once('error', no); server.listen({ host: config.listenHost, port: config.listenPort, exclusive: true }, ok); });
  ready = true;
  if (stopRequested || (hosted && !process.connected)) stop();
  else console.log('GORIQ Remote Lite HTTPS owner portal started. ' + (config.turn ? 'Temporary viewer/native TURN credentials configured; external acceptance is still required.' : config.stun ? 'Approved STUN direct candidates configured; TURN is not configured.' : 'Direct ICE only; public relay acceptance is required separately.'));
} catch (error) { portal?.close(); registry.close(); throw error; }
