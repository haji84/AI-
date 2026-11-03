import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
const { fetch, AbortSignal } = globalThis;
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const sourceRoot = new URL('../', import.meta.url);
const core = `import { createServer } from 'node:http';
const server = createServer((_request, response) => response.end('local-work-ready'));
server.listen(0, '127.0.0.1', () => console.log('BROKER_PORT=' + server.address().port));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;
const idle = "setInterval(() => {}, 1000); console.log('LOCAL_SERVICE_READY');";
const unavailableHost = () => ['10.254.254.253', '172.31.254.253', '192.168.254.253'].find(
  host => !Object.values(networkInterfaces()).flat().some(address => address?.address === host));

async function fixture(t, host, brokerFails = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'jarvis-network-test-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, '.next'));
  await mkdir(path.join(root, 'node_modules/next/dist/bin'), { recursive: true });
  await writeFile(path.join(root, '.next/BUILD_ID'), 'test-build');
  for (const name of ['jarvis-remote-host.mjs', 'jarvis-managed-process.mjs', 'jarvis-production-config.mjs']) {
    await writeFile(path.join(root, 'scripts', name), await readFile(new URL('scripts/' + name, sourceRoot)));
  }
  // Accelerate only retry scheduling; exercise the real supervisor and retry budget.
  await writeFile(path.join(root, 'scripts/jarvis-remote-access-lib.mjs'),
    'export const restartDelayMs = () => 1;');
  await writeFile(path.join(root, 'scripts/jarvis-broker.ts'),
    brokerFails ? "console.log('BROKER_FAILURE'); process.exit(1);" : core);
  await writeFile(path.join(root, 'scripts/jarvis-remote-gateway.ts'), idle);
  await writeFile(path.join(root, 'node_modules/next/dist/bin/next'), idle);
  await writeFile(path.join(root, 'scripts/jarvis-private-worker-ingress.ts'),
    "console.log('PRIVATE_INGRESS_ATTEMPT'); process.exit(1);");

  const child = spawn(process.execPath, [path.join(root, 'scripts/jarvis-remote-host.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      JARVIS_PRODUCTION_CONFIG: '',
      JARVIS_OWNER_TOKEN: 'test-only-owner-token',
      JARVIS_OWNER_SECRET: 'test-only-owner-secret',
      JARVIS_REMOTE_GATEWAY_TOKEN: 'test-only-gateway-token',
      JARVIS_REMOTE_ALLOWED_SERIALS: 'test-only-serial',
      JARVIS_ENROLLMENT_PORTAL_ENABLED: '0',
      JARVIS_PRIVATE_WORKER_INGRESS_ENABLED: brokerFails ? '0' : '1',
      JARVIS_PRIVATE_WORKER_HOST: host,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const exit = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exit;
    await rm(root, { recursive: true, force: true });
  });
  async function waitFor(predicate, message) {
    const deadline = Date.now() + 10_000;
    while (!predicate(output) && Date.now() < deadline && child.exitCode === null) await delay(20);
    assert.ok(predicate(output), message + '; stderr=' + errors);
  }
  return { child, exit, output: () => output, waitFor };
}

// Windows loads real DPAPI owner configuration; this isolated process fixture is Linux/macOS only.
const processOptions = { skip: process.platform === 'win32', timeout: 20_000 };

test('missing configured LAN leaves local Broker available without launching private ingress', processOptions, async t => {
  const host = unavailableHost();
  assert.ok(host);
  const run = await fixture(t, host);
  await run.waitFor(output => /BROKER_PORT=\d+/.test(output), 'local Broker must start');
  await delay(200);
  assert.doesNotMatch(run.output(), /PRIVATE_INGRESS_ATTEMPT/);
  const port = Number(/BROKER_PORT=(\d+)/.exec(run.output())[1]);
  const response = await fetch('http://127.0.0.1:' + port, { signal: AbortSignal.timeout(2000) });
  assert.equal(await response.text(), 'local-work-ready');
});

test('private ingress retry exhaustion preserves the independently running local Broker', processOptions, async t => {
  // The process fixture uses a local address and inert child to isolate exhaustion policy;
  // production ingress retains its own explicit private-IPv4/TLS validation.
  const run = await fixture(t, '127.0.0.1');
  await run.waitFor(output => output.includes('"service":"private-worker-ingress","state":"exhausted"'),
    'private ingress must consume its bounded retry budget');
  const port = Number(/BROKER_PORT=(\d+)/.exec(run.output())[1]);
  await assert.doesNotReject(async () => {
    const response = await fetch('http://127.0.0.1:' + port, { signal: AbortSignal.timeout(2000) });
    assert.equal(await response.text(), 'local-work-ready');
  }, 'local Broker must survive private ingress exhaustion');
  assert.doesNotMatch(run.output(), /shutting down on restart-budget-exhausted/);
});

test('core Broker retry exhaustion still invokes the existing whole-stack failure policy', processOptions, async t => {
  const run = await fixture(t, '127.0.0.1', true);
  await run.waitFor(output => output.includes('shutting down on restart-budget-exhausted'),
    'core failure must remain visible');
  const [code] = await run.exit;
  assert.equal(code, 2);
});
