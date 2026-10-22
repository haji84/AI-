// Isolate browser cold startup from the native media/input acceptance clock.
// No remote app, screen capture, input, owner key or device registration here.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';

const chrome = process.env.REMOTE_LITE_CHROME;
const driverPath = process.env.REMOTE_LITE_CHROMEDRIVER;
const expected = process.env.REMOTE_LITE_CHROME_VERSION;
if (![chrome, driverPath].every(value => typeof value === 'string' && isAbsolute(value)) ||
    !/^\d+\.\d+\.\d+\.\d+$/u.test(expected || '')) {
  throw new Error('Explicit Chrome, ChromeDriver and expected version are required');
}
await access(chrome); await access(driverPath);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const probe = createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; probe.close(); await once(probe, 'close');
const driver = spawn(driverPath, [`--port=${port}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let spawnError;
driver.once('error', error => { spawnError = error; });
driver.stdout.resume(); driver.stderr.resume();
let phase = 'driver-start', session;
const started = performance.now();
async function request(method, path, body, timeout = 20000) {
  if (spawnError) throw new Error('ChromeDriver process could not start');
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(`WebDriver refused HTTP${response.status}`);
  return result.value;
}
try {
  let ready = false;
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    if (spawnError || driver.exitCode !== null) throw new Error('ChromeDriver process ended before readiness');
    try { const state = await request('GET', '/status', undefined, 1000); ready = state.ready === true; } catch { /* bounded startup probe */ }
    if (ready) break;
    await pause(250);
  }
  if (!ready) throw new Error('ChromeDriver readiness deadline exceeded');
  const driverReadyMs = Math.round(performance.now() - started);
  phase = 'session-creation';
  // A single cold startup may be slower than subsequent acceptance sessions.
  // This is bounded infrastructure preparation, not an acceptance-test retry.
  const created = await request('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'chrome', 'goog:chromeOptions': { binary: chrome, args: ['--headless=new'] },
  } } }, 60000);
  session = created.sessionId;
  const browserVersion = created.capabilities.browserVersion;
  const driverVersion = created.capabilities.chrome?.chromedriverVersion?.split(' ')[0];
  if (browserVersion !== expected || driverVersion !== expected) throw new Error('Unexpected browser/driver version');
  phase = 'navigation';
  await request('POST', `/session/${session}/url`, { url: 'data:text/html,<title>Remote Lite preflight</title>' });
  const state = await request('POST', `/session/${session}/execute/sync`, {
    script: 'return {title:document.title,ready:document.readyState}', args: [],
  });
  if (state.title !== 'Remote Lite preflight' || state.ready !== 'complete') throw new Error('Browser document did not execute');
  phase = 'session-close';
  await request('DELETE', `/session/${session}`); session = undefined;
  process.stdout.write(JSON.stringify({ browserPreflight: 'PASS', browserVersion, driverVersion,
    driverReadyMs, elapsedMs: Math.round(performance.now() - started), sessionClosed: true }) + '\n');
} catch (error) {
  // Only this fixed data document is ever visited. Still omit payloads/IDs.
  process.stderr.write(`FAIL browser preflight phase=${phase}: ${error?.name || 'Error'}\n`);
  process.exitCode = 1;
} finally {
  if (session) await request('DELETE', `/session/${session}`).catch(() => {});
  driver.kill();
}
