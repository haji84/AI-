import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createServer, request as requestHttp } from 'node:http';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { collectCodexFreePreflight, readOllamaInventory } from '../scripts/goriq-codex-free-preflight.mjs';

const digest = 'a'.repeat(64);
const model = { name: 'qwen2.5-coder:3b', digest, size: 2048 };
const defaults = {
  readMemory: () => ({ availableBytes: 4096, totalBytes: 8192 }),
  readInventory: async () => ({ models: [model] }),
  now: () => new Date('2026-10-29T00:00:00.000Z'),
  platform: 'win32',
};
const collect = (options = {}) => collectCodexFreePreflight({ ...defaults, ...options });

async function fixture(t, handler) {
  const sockets = new Set();
  const server = createServer(handler);
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return (options, callback) => {
    assert.equal(options.hostname, '127.0.0.1');
    assert.equal(options.port, 11434);
    assert.equal(options.method, 'GET');
    assert.equal(options.agent, false);
    assert.deepEqual(Object.keys(options.headers), ['accept']);
    return requestHttp({ ...options, port: server.address().port }, callback);
  };
}

test('read-only observations never claim code generation or independent acceptance', async () => {
  const report = await collect();
  assert.equal(report.observationOnly, true);
  assert.deepEqual(report.acceptance, {
    codeGenerationExecuted: false, independentReviewExecuted: false,
    runtimeAdmission: 'NOT_EVALUATED', mergeAuthorized: false, endToEndVerified: false,
  });
  assert.equal(report.diagnosticStatus, 'OBSERVED');
});

test('records actual injected memory, timestamp and scope, not an admission decision', async () => {
  const report = await collect();
  assert.equal(report.memory.availableBytes, 4096);
  assert.equal(report.memory.totalBytes, 8192);
  assert.equal(report.memory.scope, 'HOST_OS_ONLY');
  assert.equal(report.checkedAt, '2026-10-29T00:00:00.000Z');
  assert.equal(report.platform, 'win32');
});

for (const memory of [null, {}, { availableBytes: -1, totalBytes: 2 }, { availableBytes: 3, totalBytes: 2 }, { availableBytes: NaN, totalBytes: 3 }, { availableBytes: 1, totalBytes: Infinity }, { availableBytes: 0, totalBytes: 0 }]) {
  test(`invalid or missing memory remains unknown: ${JSON.stringify(memory)}`, async () => {
    const report = await collect({ readMemory: () => memory });
    assert.equal(report.memory.status, 'UNKNOWN');
    assert.equal(report.memory.availableBytes, null);
    assert.ok(report.blockers.includes('MEMORY_MEASUREMENT_UNAVAILABLE'));
    assert.equal(report.diagnosticStatus, 'INCOMPLETE');
  });
}

test('zero available RAM is an actual measurement and never fabricated capacity', async () => {
  const report = await collect({ readMemory: () => ({ availableBytes: 0, totalBytes: 8192 }) });
  assert.equal(report.memory.status, 'OBSERVED');
  assert.equal(report.memory.availableBytes, 0);
  assert.ok(report.blockers.includes('NO_AVAILABLE_HOST_MEMORY'));
});

test('native exceptions never expose paths, credentials or raw errors', async () => {
  const report = await collect({ readMemory: () => { throw new Error('secret=TOPSECRET C:/private'); } });
  assert.equal(report.memory.status, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(report), /TOPSECRET|private/);
});

test('only inventories tags and running models, once each', async () => {
  const paths = [];
  const report = await collect({ readInventory: async path => {
    paths.push(path);
    return { models: path === '/api/tags' ? [model] : [] };
  } });
  assert.deepEqual(paths.sort(), ['/api/ps', '/api/tags']);
  assert.equal(report.ollama.installed.models.length, 1);
  assert.deepEqual(report.ollama.running.models, []);
});

test('empty installed inventory is explicit, never model generation success', async () => {
  const report = await collect({ readInventory: async () => ({ models: [] }) });
  assert.ok(report.blockers.includes('NO_INSTALLED_MODELS'));
  assert.equal(report.acceptance.endToEndVerified, false);
});

test('aliases sharing a digest are preserved without claiming independent review', async () => {
  const report = await collect({ readInventory: async () => ({ models: [model, { ...model, name: 'alias:latest' }] }) });
  assert.equal(report.ollama.installed.models[0].digest, report.ollama.installed.models[1].digest);
  assert.equal(report.acceptance.independentReviewExecuted, false);
});

test('remote hints are reported but never copied or treated as local inference', async () => {
  const report = await collect({ readInventory: async () => ({ models: [
    { ...model, remote_host: 'https://private-host.invalid', arbitrary: 'TOPSECRET' },
    { ...model, name: 'remote:cloud', remote_model: 'private-model' },
    { ...model, name: 'example:120b-cloud' },
  ] }) });
  assert.ok(report.ollama.installed.models.every(entry => entry.remoteReferenceDetected));
  assert.doesNotMatch(JSON.stringify(report), /private-host|private-model|TOPSECRET|arbitrary/);
  assert.ok(report.warnings.includes('REMOTE_MODEL_REFERENCES_PRESENT'));
  assert.equal(report.acceptance.runtimeAdmission, 'NOT_EVALUATED');
});

test('missing digest remains null with an explicit warning', async () => {
  const report = await collect({ readInventory: async () => ({ models: [{ name: 'local:latest' }] }) });
  assert.equal(report.ollama.installed.models[0].digest, null);
  assert.ok(report.warnings.includes('MODEL_DIGEST_UNAVAILABLE'));
});

for (const invalid of [null, [], {}, { models: {} }, { models: [null] }, { models: [{ name: 'bad\nname' }] }, { models: Array(257).fill(model) }]) {
  test(`malformed inventory fails closed: ${JSON.stringify(invalid).slice(0, 80)}`, async () => {
    const report = await collect({ readInventory: async () => invalid });
    assert.equal(report.ollama.installed.status, 'UNAVAILABLE');
    assert.equal(report.ollama.installed.reason, 'INVALID_SCHEMA');
    assert.deepEqual(report.ollama.installed.models, []);
  });
}

test('untrusted errors are reduced to a constant reason', async () => {
  const report = await collect({ readInventory: async () => { throw new Error('Authorization TOPSECRET'); } });
  assert.equal(report.ollama.installed.reason, 'REQUEST_FAILED');
  assert.doesNotMatch(JSON.stringify(report), /Authorization|TOPSECRET/);
});

test('HTTP uses fixed loopback GET and receives bounded chunked JSON', async t => {
  const requestImpl = await fixture(t, (req, res) => {
    assert.equal(req.url, '/api/tags');
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, undefined);
    res.write('{"models":'); res.end('[]}');
  });
  assert.deepEqual(await readOllamaInventory('/api/tags', { requestImpl }), { models: [] });
});

test('unsupported routes are rejected before opening a socket', async () => {
  let calls = 0;
  for (const path of ['/api/generate', '/api/pull', 'https://outside.invalid', '/api/tags?url=x']) {
    await assert.rejects(readOllamaInventory(path, { requestImpl: () => { calls++; } }), /INVALID_ROUTE/);
  }
  assert.equal(calls, 0);
});

test('redirects are rejected without following the Location', async t => {
  let count = 0;
  const requestImpl = await fixture(t, (_req, res) => { count++; res.writeHead(302, { location: 'https://outside.invalid/secret' }); res.end(); });
  await assert.rejects(readOllamaInventory('/api/tags', { requestImpl }), /REDIRECT_REJECTED/);
  assert.equal(count, 1);
});

test('HTTP failure does not expose response text', async t => {
  const requestImpl = await fixture(t, (_req, res) => { res.writeHead(500); res.end('TOPSECRET'); });
  await assert.rejects(readOllamaInventory('/api/tags', { requestImpl }), /^Error: HTTP_FAILED$/);
});

test('malformed JSON is an explicit sanitized error', async t => {
  const requestImpl = await fixture(t, (_req, res) => res.end('TOPSECRET not JSON'));
  await assert.rejects(readOllamaInventory('/api/tags', { requestImpl }), /^Error: INVALID_JSON$/);
});

test('oversized chunked response is terminated at the byte limit', async t => {
  const requestImpl = await fixture(t, (_req, res) => { res.write(' '); res.end(Buffer.alloc(65536, 'x')); });
  await assert.rejects(readOllamaInventory('/api/tags', { requestImpl }), /RESPONSE_TOO_LARGE/);
});

test('oversized Content-Length is rejected without reading the body', async t => {
  const requestImpl = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-length': '65537' }); res.flushHeaders(); });
  await assert.rejects(readOllamaInventory('/api/tags', { requestImpl }), /RESPONSE_TOO_LARGE/);
});

test('whole-response timeout includes a body that never ends', async t => {
  const requestImpl = await fixture(t, (_req, res) => { res.write('{"models":'); });
  await assert.rejects(readOllamaInventory('/api/tags', { requestImpl, timeoutMs: 40 }), /TIMEOUT/);
});

test('invalid timeout bounds are rejected before requests', async () => {
  let calls = 0;
  for (const timeoutMs of [0, -1, 5001, Infinity, 1.2]) {
    await assert.rejects(readOllamaInventory('/api/tags', { timeoutMs, requestImpl: () => { calls++; } }), /INVALID_TIMEOUT/);
  }
  assert.equal(calls, 0);
});

test('CLI refuses arbitrary endpoint or execution arguments', () => {
  const script = fileURLToPath(new URL('../scripts/goriq-codex-free-preflight.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [script, '--endpoint=https://outside.invalid'], { encoding: 'utf8', timeout: 2000 });
  assert.equal(child.status, 64);
  assert.equal(child.stdout.trim(), '');
  assert.equal(child.stderr.trim(), 'This read-only diagnostic takes no arguments.');
});
