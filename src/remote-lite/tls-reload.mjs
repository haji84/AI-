import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { X509Certificate, createPrivateKey, createHash } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { setInterval, clearInterval } from 'node:timers';
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

export function installTLSReload(server, paths, {
  signals = process, report = reportError,
  pollIntervalMs = process.platform === 'win32' ? 60000 : 0,
} = {}) {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 2147483647) throw Error('TLS_POLL_INTERVAL_INVALID');
  const fixedPaths = { ...paths };
  let activeDigest, failed = false;
  const reload = (polling = false) => {
    try {
      // Keep the configured TLS identity, allowing ACME to reorder its SANs.
      const options = loadTLSFiles(fixedPaths);
      const digest = createHash('sha256').update(options.cert).update(options.key).digest('hex');
      if (polling && digest === activeDigest) {
        if (failed) report('TLS_RELOAD_OK');
        failed = false;
        return;
      }
      server.setSecureContext(options);
      activeDigest = digest;
      failed = false;
    } catch {
      if (!polling || !failed) report('TLS_RELOAD_FAILED');
      failed = true;
      return;
    }
    report('TLS_RELOAD_OK');
  };
  const onSignal = () => reload();
  signals.on('SIGHUP', onSignal);
  // Windows has no operator SIGHUP reload path. Inspect only these configured
  // files; never start ACME, write keys, or install an OS task from the server.
  const timer = pollIntervalMs ? setInterval(() => reload(true), pollIntervalMs) : null;
  timer?.unref();
  server.once('close', () => {
    signals.off('SIGHUP', onSignal);
    if (timer) clearInterval(timer);
  });
}
