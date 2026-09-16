import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const allowed = new Set([
  'JARVIS_OWNER_SECRET', 'JARVIS_OWNER_TOKEN', 'JARVIS_REMOTE_GATEWAY_TOKEN',
  'JARVIS_REMOTE_ALLOWED_SERIALS', 'JARVIS_ADB_PATH', 'JARVIS_SCRCPY_SERVER_PATH',
  'JARVIS_DB_PATH', 'JARVIS_TEACHING_PATH', 'JARVIS_REMOTE_ASSIST_AUDIT_PATH',
  'JARVIS_REMOTE_ASSIST_RECORDING_DIR', 'JARVIS_PUBLIC_BROKER_URL', 'JARVIS_WORKER_INSTALL_URL',
  'JARVIS_PRIVATE_WORKER_HOST', 'JARVIS_PRIVATE_WORKER_CERT_PATH', 'JARVIS_PRIVATE_WORKER_KEY_PATH',
]);
export function validateProductionConfig(value, root) {
  if (!value || value.version !== 1 || typeof value.releaseRoot !== 'string' ||
      path.resolve(value.releaseRoot) !== path.resolve(root) || !/^[a-f0-9]{40}$/.test(value.commit ?? '') ||
      !value.environment || typeof value.environment !== 'object' || Array.isArray(value.environment)) throw Error('Invalid production configuration');
  const env = {};
  for (const [key, val] of Object.entries(value.environment)) {
    if (!allowed.has(key) || typeof val !== 'string' || !val.trim() || /[\r\n\0]/.test(val)) throw Error('Invalid production environment');
    env[key] = val;
  }
  for (const key of allowed) if (!env[key]) throw Error('Missing production setting');
  for (const key of ['JARVIS_OWNER_SECRET', 'JARVIS_OWNER_TOKEN', 'JARVIS_REMOTE_GATEWAY_TOKEN']) {
    if (env[key].length < 24) throw Error('Production credential too short');
  }
  for (const key of ['JARVIS_ADB_PATH','JARVIS_SCRCPY_SERVER_PATH','JARVIS_DB_PATH','JARVIS_TEACHING_PATH',
    'JARVIS_REMOTE_ASSIST_AUDIT_PATH','JARVIS_REMOTE_ASSIST_RECORDING_DIR','JARVIS_PRIVATE_WORKER_CERT_PATH','JARVIS_PRIVATE_WORKER_KEY_PATH']) {
    if (!path.isAbsolute(env[key])) throw Error('Absolute installation paths required');
  }
  const host = env.JARVIS_PRIVATE_WORKER_HOST;
  const parts = host.split('.').map(Number);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) || parts.some(n => n < 0 || n > 255) ||
      !(parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168)) throw Error('Private IPv4 required');
  if (env.JARVIS_PUBLIC_BROKER_URL !== `https://${host}:8792`) throw Error('Worker origin mismatch');
  const download = new URL(env.JARVIS_WORKER_INSTALL_URL);
  if (download.protocol !== 'https:' || download.username || download.password) throw Error('Invalid APK URL');
  return { ...env, NODE_ENV: 'production', JARVIS_BROKER_HOST: '127.0.0.1',
    JARVIS_BROKER_URL: 'http://127.0.0.1:8787', JARVIS_REMOTE_GATEWAY_URL: 'http://127.0.0.1:8790',
    JARVIS_REMOTE_GATEWAY_HOST: '127.0.0.1', JARVIS_BROKER_PORT: '8787', JARVIS_REMOTE_GATEWAY_PORT: '8790',
    JARVIS_DASHBOARD_PORT: '3000', JARVIS_ENROLLMENT_PORTAL_ENABLED: '0',
    JARVIS_PRIVATE_WORKER_INGRESS_ENABLED: '1', JARVIS_PRIVATE_WORKER_PORT: '8792' };
}

export function loadWindowsProductionConfig(root) {
  if (process.platform !== 'win32') return;
  const file = process.env.JARVIS_PRODUCTION_CONFIG || path.join(process.env.LOCALAPPDATA || '', 'JARVIS', 'production', 'config.dpapi');
  if (!fs.existsSync(file)) {
    if (process.env.JARVIS_PRODUCTION_CONFIG) throw Error('Missing configuration');
    return;
  }
  // DPAPI CurrentUser: decrypt only as the same Windows owner. Never print the result.
  const output = execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/read-jarvis-production-config.ps1'), '-Path', file],
    { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 });
  const value = JSON.parse(output.replace(/^\uFEFF/, ''));
  const env = validateProductionConfig(value, root);
  const release = JSON.parse(fs.readFileSync(path.join(root, 'jarvis-release.json'), 'utf8'));
  if (release.commit !== value.commit) throw Error('Release does not match configuration');
  Object.assign(process.env, env);
}
