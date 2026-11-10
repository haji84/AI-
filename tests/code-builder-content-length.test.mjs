import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createCodeBuilderWorkerServer } from '../scripts/code-builder-worker-service.ts';

const models = JSON.stringify({ models: [{ name: 'qwen2.5-coder:3b' }] });
async function health(length, body = models, authorized = true) {
  let calls = 0;
  const server = createCodeBuilderWorkerServer({
    env: { NODE_ENV: 'test', CODE_BUILDER_TOKEN: 'content-length-test-only', CODE_BUILDER_WORKSPACE: process.cwd(), GORIQ_ALLOW_LEGACY_CODE_BUILDER: '0' },
    repairFetchImpl: async (input) => {
      calls++;
      assert.equal(String(input), 'http://127.0.0.1:11434/api/tags');
      const headers = { 'content-type': 'application/json' };
      if (length !== null) headers['content-length'] = length;
      return new globalThis.Response(body, { headers });
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await globalThis.fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: authorized ? { Authorization: 'Bearer content-length-test-only' } : {},
      signal: globalThis.AbortSignal.timeout(3000),
    });
    return { status: response.status, body: await response.json(), calls };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('numeric Content-Length accepts an installed local model', async () => {
  const result = await health(String(Buffer.byteLength(models)));
  assert.equal(result.status, 200);
  assert.equal(result.body.engine, 'goriq-ollama-repair');
  assert.ok(result.body.capabilities.includes('code-builder'));
  assert.deepEqual(result.body.inference, { locality: 'device', networkAccess: false });
});
test('a missing Content-Length retains stream-size validation', async () => {
  assert.equal((await health(null)).body.engine, 'goriq-ollama-repair');
});
for (const value of ['65537', '-1', '1e3', 'oops', '\\d']) {
  test(`invalid Content-Length ${JSON.stringify(value)} does not grant Builder capability`, async () => {
    const result = await health(value);
    assert.equal(result.body.engine, null);
    assert.deepEqual(result.body.capabilities, ['filesystem']);
  });
}
test('oversized actual body is refused even without a length header', async () => {
  assert.equal((await health(null, models + ' '.repeat(65537))).body.engine, null);
});
test('unauthenticated health does not inspect models', async () => {
  const result = await health(String(Buffer.byteLength(models)), models, false);
  assert.equal(result.status, 401);
  assert.equal(result.calls, 0);
});
