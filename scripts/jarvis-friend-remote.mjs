import { isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';
import { manageProcess } from './jarvis-managed-process.mjs';

const allowedEnvironment = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'HOME', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']);
function childEnvironment(source) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const canonical = key.toUpperCase();
    if (!allowedEnvironment.has(canonical)) continue;
    if (typeof value !== 'string' || value.includes('\0') ||
        (Object.hasOwn(result, canonical) && result[canonical] !== value)) throw Error('Invalid OS environment');
    result[canonical] = value;
  }
  result.NODE_ENV = 'production';
  return result;
}

/** Optional GORIQ feature. No core credentials or core shutdown callback enter
 * this child's launch options. Configuration and accounts remain operator-owned. */
export function startGoriqFriendRemote({ root, configPath, env = process.env,
  node = process.execPath, report = () => {}, stdio = 'inherit' } = {}) {
  if (configPath === undefined) return null;
  try {
    if (typeof configPath !== 'string' || configPath !== configPath.trim() ||
        /[\r\n\0]/u.test(configPath) || !isAbsolute(configPath) || !isAbsolute(root) || !isAbsolute(node) ||
        !['inherit', 'ignore'].includes(stdio)) throw Error('Invalid launch configuration');
    const requestStop = child => {
      // Windows SIGTERM is forcible. Ask only this owned child to close its
      // registry first, then bound the wait within the host's 2-second exit.
      let forced = false;
      const force = () => {
        if (forced || child.exitCode !== null || child.signalCode !== null) return;
        forced = true;
        const delivered = child.kill('SIGKILL');
        report({ service: 'friend-remote', state: delivered ? 'forced-stop-requested' : 'stop-unconfirmed' });
      };
      const timer = setTimeout(force, 1250);
      timer.unref();
      const clear = () => clearTimeout(timer);
      child.once('exit', clear); child.once('close', clear);
      if (child.connected) child.send({ type: 'goriq-friend-stop' }, error => { if (error) force(); });
      else force();
      return true;
    };
    return manageProcess({ name: 'friend-remote', command: node,
      args: [join(root, 'scripts', 'remote-lite-owner-server.mjs'), configPath, '--goriq-friend'] },
    { cwd: root, env: childEnvironment(env), report, maxFailures: 3, requestStop,
      spawn: (command, args, options) => spawn(command, args, { ...options, stdio: ['ignore', stdio, stdio, 'ipc'] }) });
  } catch {
    report({ service: 'friend-remote', state: 'disabled', reason: 'invalid-friend-configuration' });
    return null;
  }
}
