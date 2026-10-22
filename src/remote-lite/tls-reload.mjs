import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { isIP } from 'node:net';
import process from 'node:process';
import { error as reportError } from 'node:console';

const boundedRead = (path, limit) => {
  // Follow the operator-controlled ACME live symlink, but inspect/read the same
  // opened file. No watcher, path discovery or private material in diagnostics.
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw Error('TLS_FILES_INVALID');
    return readFileSync(fd);
  } finally { closeSync(fd); }
};

export function loadTLSFiles({ certPath, keyPath, serverName }) {
  try {
    const cert = boundedRead(certPath, 1024 * 1024), key = boundedRead(keyPath, 65536);
    const leaf = new X509Certificate(cert), now = Date.now();
    if (typeof serverName !== 'string' || !serverName || !leaf.subjectAltName ||
        !(isIP(serverName) ? leaf.checkIP(serverName) : leaf.checkHost(serverName, { subject: 'never' })) ||
        !(Date.parse(leaf.validFrom) <= now && now < Date.parse(leaf.validTo)) ||
        !leaf.checkPrivateKey(createPrivateKey(key))) throw Error('TLS_FILES_INVALID');
    const options = { cert, key, minVersion: 'TLSv1.2' };
    createSecureContext(options); // Validate the complete pair before swapping.
    return options;
  } catch { throw Error('TLS_FILES_INVALID'); }
}

export function installTLSReload(server, paths, { signals = process, report = reportError } = {}) {
  const fixedPaths = { ...paths };
  const reload = () => {
    try {
      // Keep the configured TLS identity, allowing ACME to reorder its SANs.
      const options = loadTLSFiles(fixedPaths);
      server.setSecureContext(options);
    } catch { report('TLS_RELOAD_FAILED'); return; }
    report('TLS_RELOAD_OK');
  };
  signals.on('SIGHUP', reload);
  server.once('close', () => signals.off('SIGHUP', reload));
}
