import fs from 'node:fs';
import path from 'node:path';
import { manageProcess, serviceSpecs } from './jarvis-managed-process.mjs';

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function refuse(message) {
  console.error(`REMOTE_HOST_REFUSED: ${message}`);
  process.exit(2);
}

loadEnvFile('.env');
loadEnvFile('.env.local');

for (const key of ['JARVIS_OWNER_TOKEN', 'JARVIS_REMOTE_GATEWAY_TOKEN', 'JARVIS_REMOTE_ALLOWED_SERIALS']) {
  if (!process.env[key]?.trim()) refuse(`${key} is required in the environment or .env.local`);
}
if (!process.env.JARVIS_OWNER_SECRET?.trim() && !process.env.AI_COMPANY_OWNER_SECRET?.trim()) {
  refuse('JARVIS_OWNER_SECRET or AI_COMPANY_OWNER_SECRET is required for owner-authenticated dashboard access');
}
if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) {
  refuse('production dashboard build is missing; run pnpm build before starting the remote host');
}

const enrollmentPortalEnabled = Boolean(process.env.JARVIS_ENROLLMENT_PORTAL_KEY?.trim());
const specs = serviceSpecs(root, process.execPath, process.env.JARVIS_DASHBOARD_PORT || '3000', { enableEnrollmentPortal: enrollmentPortalEnabled });

function startManaged(spec) {
  if (shuttingDown.value) return;
  console.log(`[remote-host] starting ${spec.name}`);
  const child = manageProcess(spec, {
    cwd: root,
    env: {
      ...process.env,
      JARVIS_BROKER_URL: process.env.JARVIS_BROKER_URL || 'http://127.0.0.1:8787',
      JARVIS_REMOTE_GATEWAY_URL: process.env.JARVIS_REMOTE_GATEWAY_URL || 'http://127.0.0.1:8790',
    },
    stdio: 'inherit',
    report: event => console.log(`[remote-host] ${JSON.stringify(event)}`),
    onExhausted: () => shutdown('restart-budget-exhausted', 2),
  });
  children.set(spec.name, child);
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown.value) return;
  shuttingDown.value = true;
  console.log(`[remote-host] shutting down on ${signal}`);
  for (const child of children.values()) {
    try { child.stop(); } catch {}
  }
  process.exitCode = exitCode;
  setTimeout(() => process.exit(exitCode), 2_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('[remote-host] uncaught exception', error);
  shutdown('uncaughtException', 2);
});

if (!enrollmentPortalEnabled) {
  console.log('[remote-host] enrollment portal disabled: JARVIS_ENROLLMENT_PORTAL_KEY is not provisioned');
}
for (const spec of specs) startManaged(spec);
console.log('[remote-host] JARVIS remote stack supervisor active');
