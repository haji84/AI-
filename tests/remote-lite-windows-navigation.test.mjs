import assert from 'node:assert/strict';
import test from 'node:test';
import { navigateWindowsFixture } from '../scripts/remote-lite-windows-browser-navigation.mjs';

function fixture(overrides = {}) {
  const destination = overrides.destination || 'http://127.0.0.1:43001/';
  const state = { navigations: 0 };
  const requestId = 'test-request';
  const errorText = overrides.errorText || 'net::ERR_ABORTED';
  const events = [
    { method: 'Network.requestWillBeSent', params: { type: 'Document', requestId, request: { url: destination } } },
    { method: 'Network.loadingFailed', params: { type: 'Document', requestId, errorText,
      canceled: overrides.canceled ?? true, ...(overrides.blocked ? { blockedReason: 'inspector' } : {}) } },
  ];
  if (overrides.response) events.push({ method: 'Network.responseReceived', params: {
    type: 'Document', requestId, response: { status: overrides.response, mimeType: 'text/html' },
  } });
  const webdriver = async (method, path, body) => {
    assert.equal(method, 'POST');
    if (path.endsWith('/log')) {
      if (overrides.missingDiagnostics) throw new Error('logging unavailable');
      return events.map(message => ({ message: JSON.stringify({ message }) }));
    }
    if (path.endsWith('/goog/cdp/execute')) {
      assert.equal(body.cmd, 'Page.navigate');
      assert.equal(body.params.url, destination);
      state.navigations++;
      return state.navigations <= (overrides.failures ?? 1)
        ? { frameId: overrides.missingFrame ? undefined : 'test-frame', errorText, isDownload: overrides.download || false }
        : { frameId: 'test-frame' };
    }
    if (path.endsWith('/execute/sync')) return body.script.includes('bootstrap:')
      ? { bootstrap: overrides.bootstrap ?? true, target: overrides.target ?? false } : true;
    throw new Error('unexpected driver request');
  };
  return { webdriver, state, destination };
}

test('a canceled fixed GET before any response or commit can recover once before acceptance', async () => {
  const f = fixture();
  assert.deepEqual(await navigateWindowsFixture(f.webdriver, 'test', f.destination, { recoverBootstrap: true }), { recoveries: 1 });
  assert.equal(f.state.navigations, 2);
});

test('repeated cancellation exhausts one recovery without a third navigation', async () => {
  const f = fixture({ failures: 2 });
  await assert.rejects(navigateWindowsFixture(f.webdriver, 'test', f.destination, { recoverBootstrap: true }), /ERR_ABORTED/u);
  assert.equal(f.state.navigations, 2);
});

test('setup fragment permits only pre-response bootstrap recovery and is never logged', async () => {
  const destination = 'http://127.0.0.1:43001/#token=' + 'f'.repeat(64);
  const f = fixture({ destination });
  assert.deepEqual(await navigateWindowsFixture(f.webdriver, 'test', destination, { recoverBootstrap: true }), { recoveries: 1 });
  assert.equal(f.state.navigations, 2);
  for (const change of [{ response: 200 }, { target: true }, { failures: 2 }]) {
    const denied = fixture({ destination, ...change });
    await assert.rejects(navigateWindowsFixture(denied.webdriver, 'test', destination, { recoverBootstrap: true }), error => {
      assert.equal(error.message.includes('f'.repeat(64)), false);
      return /ERR_ABORTED/u.test(error.message);
    });
    assert.equal(denied.state.navigations, change.failures ? 2 : 1);
  }
});

for (const [name, overrides] of Object.entries({
  'successful HTTP response': { response: 200 },
  'HTTP denial': { response: 403 },
  'blocked request': { blocked: true },
  'non-canceled error': { canceled: false },
  'different network error': { errorText: 'net::ERR_CONNECTION_REFUSED' },
  'missing bootstrap': { bootstrap: false },
  'committed target': { target: true },
  'download': { download: true },
  'missing frame': { missingFrame: true },
  'missing diagnostics': { missingDiagnostics: true },
  'API route': { destination: 'http://127.0.0.1:43001/api/setup/close' },
  'query parameters': { destination: 'http://127.0.0.1:43001/?action=close' },
})) {
  test(`no recovery for ${name}`, async () => {
    const f = fixture(overrides);
    await assert.rejects(navigateWindowsFixture(f.webdriver, 'test', f.destination, { recoverBootstrap: true }));
    assert.equal(f.state.navigations, 1);
  });
}

test('recovery is disabled for callers that do not explicitly opt in', async () => {
  const f = fixture();
  await assert.rejects(navigateWindowsFixture(f.webdriver, 'test', f.destination));
  assert.equal(f.state.navigations, 1);
});

test('certificate-pinned HTTPS fixture opt-in keeps non-loopback refusal and never retries HTTPS', async () => {
  const destination = 'https://127.0.0.1:43001/';
  const disabled = fixture({ destination, failures: 0 });
  await assert.rejects(navigateWindowsFixture(disabled.webdriver, 'test', destination), /loopback fixture/u);
  assert.equal(disabled.state.navigations, 0);
  const success = fixture({ destination, failures: 0 });
  assert.deepEqual(await navigateWindowsFixture(success.webdriver, 'test', destination, { allowHttps: true }), { recoveries: 0 });
  const aborted = fixture({ destination });
  await assert.rejects(navigateWindowsFixture(aborted.webdriver, 'test', destination,
    { allowHttps: true, recoverBootstrap: true }), /ERR_ABORTED/u);
  assert.equal(aborted.state.navigations, 1);
  for (const target of ['https://remote.invalid:443/', 'https://user@127.0.0.1:43001/']) {
    await assert.rejects(navigateWindowsFixture(success.webdriver, 'test', target, { allowHttps: true }), /loopback fixture/u);
  }
});
