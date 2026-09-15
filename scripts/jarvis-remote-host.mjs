import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { restartDelayMs } from './jarvis-remote-access-lib.mjs';

const root = process.cwd();
const shuttingDown = { value: false };
const children = new Map();

function loadEnvFile(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;
  for (const rawLine of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

for (const key of ['JARVIS_OWNER_TOKEN', 'JARVIS_REMOTE_GATEWAY_TOKEN']) {
  if (!process.env[key]?.trim()) {
    console.error(`REMOTE_HOST_REFUSED: ${key} is required in the environment or .env.local`);
    process.exit(2);
  }
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const specs = [
  { name: 'broker', command: process.execPath, args: ['scripts/jarvis-broker.ts'] },
  { name: 'remote-gateway', command: process.execPath, args: ['scripts/jarvis-remote-gateway.ts'] },
  { name: 'dashboard', command: pnpm, args: ['exec', 'next', 'start', '-H', '127.0.0.1', '-p', process.env.JARVIS_DASHBOARD_PORT || '3000'] },
];

function startManaged(spec, attempt = 1) {
  if (shuttingDown.value) return;
  console.log(`[remote-host] starting ${spec.name}`);
  const startedAt = Date.now();
  const child = spawn(spec.command, spec.args, {
    cwd: root,
    env: {
      ...process.env,
      JARVIS_BROKER_URL: process.env.JARVIS_BROKER_URL || 'http://127.0.0.1:8787',
      JARVIS_REMOTE_GATEWAY_URL: process.env.JARVIS_REMOTE_GATEWAY_URL || 'http://127.0.0.1:8790',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  children.set(spec.name, child);

  child.once('exit', (code, signal) => {
    children.delete(spec.name);
    if (shuttingDown.value) return;
    const stable = Date.now() - startedAt >= 60_000;
    const nextAttempt = stable ? 1 : attempt + 1;
    const delay = restartDelayMs(nextAttempt);
    console.error(`[remote-host] ${spec.name} exited code=${code ?? 'null'} signal=${signal ?? 'null'}; restarting in ${delay}ms`);
    setTimeout(() => startManaged(spec, nextAttempt), delay).unref();
  });

  child.once('error', (error) => {
    console.error(`[remote-host] ${spec.name} spawn error: ${error.message}`);
  });
}

function shutdown(signal) {
  if (shuttingDown.value) return;
  shuttingDown.value = true;
  console.log(`[remote-host] shutting down on ${signal}`);
  for (const child of children.values()) {
    try { child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(0), 2_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('[remote-host] uncaught exception', error);
  shutdown('uncaughtException');
});

for (const spec of specs) startManaged(spec);
console.log('[remote-host] JARVIS remote stack supervisor active');
