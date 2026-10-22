import { createServer } from 'node:https';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createOwnerPortal } from '../src/remote-lite/owner-portal.mjs';
import { openRemoteRegistry } from '../src/remote-lite/registry-file.mjs';
import { createPortalTurnIssuer } from '../src/remote-lite/turn-credentials.mjs';

// Operator command only. Friends use the HTTPS UI/APK/EXE. No production key is
// generated or printed; provision a distinct random owner key via approved means.
const [configPath, mode] = process.argv.slice(2);
if (!configPath || (mode && mode !== '--initialize')) throw new Error('Usage: node scripts/remote-lite-owner-server.mjs <private-config.json> [--initialize]');
const absolute = resolve(configPath);
if (lstatSync(absolute).size > 16384) throw new Error('Configuration too large');
const config = JSON.parse(readFileSync(absolute, 'utf8'));
const allowed = ['origin','listenHost','listenPort','tlsCert','tlsKey','stateDirectory','owners','turn'];
if (!config || Object.keys(config).some(k => !allowed.includes(k)) ||
  typeof config.listenHost !== 'string' || !Number.isInteger(config.listenPort) || config.listenPort < 1 || config.listenPort > 65535) throw new Error('Explicit HTTPS listener configuration required');
const relative = p => { if (typeof p !== 'string' || !p) throw new Error('Path required'); return resolve(dirname(absolute), p); };
let iceForSession;
if (config.turn !== undefined) {
  const turn = config.turn;
  if (!turn || typeof turn !== 'object' || Array.isArray(turn) || Object.keys(turn).some(k => !['urls','sharedSecretFile'].includes(k))) throw new Error('Invalid TURN configuration');
  const secretPath = relative(turn.sharedSecretFile);
  if (lstatSync(secretPath).size > 512) throw new Error('TURN secret file too large');
  iceForSession = createPortalTurnIssuer({ urls: turn.urls, sharedSecret: readFileSync(secretPath, 'utf8').trim() });
}
const registry = openRemoteRegistry(relative(config.stateDirectory), { initialize: mode === '--initialize' });
let portal, server;
try {
  portal = createOwnerPortal({ origin: config.origin, owners: config.owners, iceForSession, ...registry });
  server = createServer({ cert: readFileSync(relative(config.tlsCert)), key: readFileSync(relative(config.tlsKey)), minVersion: 'TLSv1.2' }, portal.handler);
  server.maxHeadersCount = 24; server.headersTimeout = 10000; server.requestTimeout = 10000; server.maxConnections = 512;
  await new Promise((ok, no) => { server.once('error', no); server.listen({ host: config.listenHost, port: config.listenPort, exclusive: true }, ok); });
  console.log('GORIQ Remote Lite HTTPS owner portal started. ' + (iceForSession ? 'Temporary viewer/native TURN credentials configured; external acceptance is still required.' : 'Direct ICE only; public relay acceptance is required separately.'));
} catch (error) { portal?.close(); registry.close(); throw error; }
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  portal.close(); server.closeAllConnections(); server.close(() => registry.close());
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
