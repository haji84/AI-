import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { createInterface } from 'node:readline';

test('VM fixture exposes a viewer capability usable only with owner authentication', async () => {
  const child = spawn(process.execPath, ['scripts/remote-lite-go-vm-fixture.mjs'], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  try {
    let timeout;
    const ready = await Promise.race([
      (async () => { for await (const line of lines) return JSON.parse(line); })(),
      new Promise((_, reject) => { timeout = globalThis.setTimeout(() => reject(new Error('fixture timeout: ' + errors)), 5000); }),
    ]).finally(() => globalThis.clearTimeout(timeout));
    assert.equal(ready.event, 'ready');
    assert.match(ready.viewerToken, /^[0-9a-f]{64}$/);
    const body = JSON.stringify({ sessionId: ready.sessionId, viewerToken: ready.viewerToken });
    const unauthenticated = await globalThis.fetch(ready.url + '/v1/viewer/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(unauthenticated.status, 401);
    const authenticated = await globalThis.fetch(ready.url + '/v1/viewer/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer vm-test-owner' }, body,
    });
    assert.equal(authenticated.status, 200);
    assert.equal((await authenticated.json()).result.status, 'pending');
  } finally {
    child.stdin.end('exit\n');
    lines.close();
    await new Promise(resolve => child.once('exit', resolve));
  }
});
