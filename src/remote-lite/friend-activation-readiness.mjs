import { lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, join } from 'node:path';
import { readGoriqHostedPortalConfig } from './goriq-hosted-config.mjs';
import { RemoteOwnerAuth } from './owner-auth.mjs';
import { loadTLSFiles } from './tls-reload.mjs';
import { createPortalTurnIssuer, createPortalStunIssuer } from './turn-credentials.mjs';

/**
 * Pure operator-side readiness inspection. This does not create an account,
 * register a device, open a socket, initialize a registry, change a policy or
 * expose any credential/path in its result. "Configured" is never "deployed".
 */
export function inspectFriendActivation(wrapperPath) {
  const checks = {
    distinctFriendOrigin: false, friendLoginHashes: false,
    localTlsIdentity: false, existingRegistry: false,
    networkIceConfigured: false,
  };
  const blockers = [];
  const note = code => { if (!blockers.includes(code)) blockers.push(code); };
  let config, root;
  try {
    const loaded = readGoriqHostedPortalConfig(wrapperPath);
    config = loaded.config;
    root = dirname(loaded.configPath);
    checks.distinctFriendOrigin = true;
  } catch { note('FRIEND_CONFIG_NOT_VALIDATED'); }

  if (config) {
    try {
      const auth = new RemoteOwnerAuth({ owners: config.owners });
      auth.close();
      checks.friendLoginHashes = true;
    } catch { note('FRIEND_LOGIN_CONFIGURATION_INVALID'); }

    try {
      if (!Number.isInteger(config.listenPort) || config.listenPort < 1 || config.listenPort > 65535 ||
          typeof config.listenHost !== 'string' || !config.listenHost ||
          typeof config.tlsCert !== 'string' || typeof config.tlsKey !== 'string') throw Error('INVALID');
      const hostname = new URL(config.origin).hostname.replace(/^\[|\]$/gu, '');
      const requestedName = config.tlsServerName ?? hostname;
      // Do not accept a public listener with a certificate for an unrelated name.
      if (requestedName !== hostname && !['127.0.0.1', '::1'].includes(config.listenHost)) throw Error('INVALID');
      const certPath = resolve(root, config.tlsCert), keyPath = resolve(root, config.tlsKey);
      if (!isAbsolute(certPath) || !isAbsolute(keyPath)) throw Error('INVALID');
      loadTLSFiles({ certPath, keyPath, serverName: requestedName });
      checks.localTlsIdentity = true;
    } catch { note('FRIEND_LOCAL_TLS_IDENTITY_INVALID'); }

    try {
      if (typeof config.stateDirectory !== 'string' || !config.stateDirectory) throw Error('INVALID');
      const directory = resolve(root, config.stateDirectory);
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('INVALID');
      const file = join(directory, 'devices.json'), fileInfo = lstatSync(file);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size < 1 || fileInfo.size > 1_048_576) throw Error('INVALID');
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (!saved || Object.keys(saved).sort().join(',') !== 'devices,version' ||
          saved.version !== 1 || !Array.isArray(saved.devices) || saved.devices.length > 2000 ||
          saved.devices.some(device => !device || !config.owners?.some(owner => owner.ownerId === device.ownerId))) {
        throw Error('INVALID');
      }
      checks.existingRegistry = true;
    } catch { note('FRIEND_REGISTRY_UNAVAILABLE'); }

    try {
      if (config.turn !== undefined && config.stun === undefined) {
        const turn = config.turn;
        if (!turn || Object.keys(turn).some(k => !['urls', 'sharedSecretFile'].includes(k)) ||
            typeof turn.sharedSecretFile !== 'string') throw Error('INVALID');
        const file = resolve(root, turn.sharedSecretFile), stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 512) throw Error('INVALID');
        createPortalTurnIssuer({ urls: turn.urls, sharedSecret: readFileSync(file, 'utf8').trim() });
      } else if (config.stun !== undefined && config.turn === undefined) {
        createPortalStunIssuer(config.stun);
      } else throw Error('INVALID');
      checks.networkIceConfigured = true;
    } catch { note('FRIEND_ICE_MODE_UNCONFIRMED'); }
  }

  const configured = Object.values(checks).every(Boolean);
  return {
    kind: 'remote-lite-friend-readiness', configured,
    checks, blockers,
    deploymentAccepted: false,
    physicalIphoneAccepted: false,
    deviceAndFriendAccountAccepted: false,
    distributionSignedAndAccepted: false,
    requiredGates: [
      'OWNER_APPROVE_FRIEND_ID_AND_ACCOUNT',
      'OWNER_APPROVE_REAL_LISTENER_AND_OS_NETWORK_SCOPE',
      'OWNER_ATTEST_TAILSCALE_FRIEND_ONLY_ACCESS',
      'OWNER_ACCEPT_REAL_IPHONE_AND_NATIVE_DEVICE_E2E',
      'OWNER_APPROVE_DISTRIBUTION_SIGNING_AND_RELEASE',
    ],
  };
}
