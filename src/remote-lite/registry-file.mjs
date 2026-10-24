import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

/** Exclusive independent state directory. Missing/corrupt registry never becomes
 * an empty authority. Initialization is an explicit operator operation. A crash
 * leaves the lock and requires an operator to confirm the old process is gone. */
export function openRemoteRegistry(directory, { initialize = false } = {}) {
  const root = resolve(directory);
  if (initialize) mkdirSync(root, { mode: 0o700 });
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Registry directory invalid');
  const lock = join(root, 'registry.lock');
  const lockFd = openSync(lock, 'wx', 0o600);
  const file = join(root, 'devices.json');
  let closed = false;
  const close = () => { if (!closed) { closed = true; closeSync(lockFd); unlinkSync(lock); } };
  const persist = records => {
    if (closed || !Array.isArray(records) || records.length > 100) throw new Error('Registry unavailable');
    const data = JSON.stringify({ version: 1, devices: records }) + '\n';
    if (data.length > 131072) throw new Error('Registry too large');
    const temp = join(root, '.devices-' + randomBytes(12).toString('hex') + '.tmp');
    let fd, failure;
    try {
      fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, data); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temp, file);
      if (process.platform !== 'win32') { const dirFd = openSync(root, 'r'); try { fsyncSync(dirFd); } finally { closeSync(dirFd); } }
    } catch (e) { failure = e; }
    if (fd !== undefined) { try { closeSync(fd); } catch (e) { failure ||= e; } }
    try { unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') failure ||= e; }
    if (failure) throw failure;
  };
  try {
    if (initialize) persist([]);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072) throw new Error('Registry file invalid');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || Object.keys(data).sort().join(',') !== 'devices,version' || data.version !== 1 || !Array.isArray(data.devices)) throw new Error('Registry content invalid');
    return { initialDevices: data.devices, persistDevices: persist, close };
  } catch (e) { close(); throw e; }
}
