// Disposable Windows VM: drive the embedded localhost preview through its
// fail-closed remote route, real GDI frames, SendInput, and browser WebRTC.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';

const pageUrl = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{64}&remote=1$/u.test(pageUrl || '')) {
  throw new Error('loopback VM page URL required');
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const driverPort = probe.address().port;
probe.close();
await once(probe, 'close');
const driverUrl = `http://127.0.0.1:${driverPort}`;
const driver = spawn(process.env.REMOTE_LITE_CHROMEDRIVER || 'chromedriver', [`--port=${driverPort}`],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
for (const stream of [driver.stdout, driver.stderr]) stream.on('data', chunk => {
  driverLog = (driverLog + chunk.toString()).slice(-3000);
});
const webdriver = async (method, path, body) => {
  const response = await fetch(driverUrl + path, { method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(result.value?.message || `WebDriver HTTP ${response.status}`);
  return result.value;
};
let sessionId;
try {
  let started = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (driver.exitCode !== null) throw new Error('ChromeDriver exited: ' + driverLog);
    try { await webdriver('GET', '/status'); started = true; break; } catch { await pause(250); }
  }
  if (!started) throw new Error('ChromeDriver unavailable: ' + driverLog);
  const session = await webdriver('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new'] },
  } } });
  sessionId = session.sessionId;
  await webdriver('POST', `/session/${sessionId}/url`, { url: pageUrl });
  const evalPage = script => webdriver('POST', `/session/${sessionId}/execute/sync`, { script, args: [] });
  let loaded = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const state = await evalPage('return { width: document.querySelector("#screen")?.naturalWidth || 0, error: document.querySelector("#error")?.textContent }');
    if (state.width > 0) { loaded = true; break; }
    if (state.error) throw new Error('native frame request failed: ' + state.error);
    await pause(150);
  }
  if (!loaded) throw new Error('native JPEG did not load');
  await evalPage('window.confirm = () => true; document.querySelector("#rtcStart").click(); return true');
  let mediaReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await evalPage('return { text: document.querySelector("#rtcStatus").textContent, width: document.querySelector("#rtcVideo").videoWidth, input: !document.querySelector("#rtcInput").disabled }');
    if (state.text.startsWith('PASS:') && state.width > 0 && state.input) { mediaReady = true; break; }
    if (/失敗|応答なし|拒否/u.test(state.text)) throw new Error('native WebRTC failed: ' + state.text);
    await pause(150);
  }
  if (!mediaReady) throw new Error('native video/DataChannel did not connect');
  await evalPage('document.querySelector("#rtcInput").click(); return true');
  let inputReady = false;
  for (let attempt = 0; attempt < 70; attempt++) {
    const state = await evalPage('return document.querySelector("#rtcStatus").textContent');
    if (state.includes('Windowsが受理')) { inputReady = true; break; }
    if (state.includes('拒否')) throw new Error('native SendInput refused: ' + state);
    await pause(150);
  }
  if (!inputReady) throw new Error('manual DataChannel input lacked native acknowledgement');
  process.stdout.write(JSON.stringify({ event: 'active', nativeJPEG: true, decodedVideo: true,
    manualNativeAck: true }) + '\n');
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) { if (line === 'revoke') break; }
  let stopped = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = await evalPage('return { text: document.querySelector("#rtcStatus").textContent, stream: document.querySelector("#rtcVideo").srcObject, image: document.querySelector("#screen").getAttribute("src") }');
    if (state.text.includes('署名付き端末セッション') && state.stream === null && state.image === null) {
      stopped = true; break;
    }
    await pause(150);
  }
  if (!stopped) throw new Error('revoked native WebRTC media did not stop');
  process.stdout.write(JSON.stringify({ event: 'stopped', revokedVideoClosed: true }) + '\n');
} catch (error) {
  process.stderr.write(`FAIL Windows native browser VM: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (sessionId) await webdriver('DELETE', `/session/${sessionId}`).catch(() => {});
  driver.kill();
}
