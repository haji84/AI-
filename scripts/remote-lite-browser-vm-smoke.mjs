/** Real Chromium WebRTC smoke on a disposable VM. No screen or OS input. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const html = `<!doctype html><meta charset="utf-8"><title>Remote Lite VM RTC</title><script type="module">
import { BrowserManualPeer } from '/src/remote-lite/browser-webrtc.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(ready, label) {
  for (let i = 0; i < 120; i++) { if (ready()) return; await wait(100); }
  throw new Error('timeout: ' + label);
}
let host, viewer, timer;
try {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 72;
  const ctx = canvas.getContext('2d');
  let shade = 0;
  timer = setInterval(() => { ctx.fillStyle = shade++ % 2 ? '#07bcd4' : '#eeaa44'; ctx.fillRect(0, 0, 128, 72); }, 80);
  ctx.fillStyle = '#07bcd4'; ctx.fillRect(0, 0, 128, 72);
  const stream = canvas.captureStream(12);
  const video = document.createElement('video');
  video.autoplay = true; video.muted = true; video.playsInline = true;
  document.body.append(video);
  let frame = false, applied = 0, acknowledged = 0, active = true;
  const pc = configuration => new RTCPeerConnection(configuration);
  host = new BrowserManualPeer({ role: 'host', rtcFactory: pc,
    sendSignal: signal => viewer.receiveSignal(signal),
    requestScreen: async () => stream, checkSession: async () => active,
    onManualInput: command => { if (command.action !== 'tap') throw new Error('wrong input'); applied++; return true; } });
  viewer = new BrowserManualPeer({ role: 'viewer', rtcFactory: pc,
    sendSignal: signal => host.receiveSignal(signal),
    onStream: received => {
      video.srcObject = received;
      video.requestVideoFrameCallback?.(() => { frame = true; });
      video.play().catch(error => { window.__remoteLiteResult = { status: 'FAIL', error: 'video: ' + error.message }; });
    },
    onManualAcknowledged: () => { acknowledged++; } });
  await host.approveLocalScreen();
  await viewer.startViewer();
  await until(() => viewer.connected && host.connected && frame, 'media and data connection');
  viewer.sendManual({ action: 'tap', x: .5, y: .5 });
  await until(() => applied === 1 && acknowledged === 1, 'manual input acknowledgement');
  active = false;
  await host.verifySession();
  await until(() => host.closed && stream.getVideoTracks()[0].readyState === 'ended', 'revoked capture stop');
  window.__remoteLiteResult = { status: 'PASS', videoWidth: video.videoWidth, applied, acknowledged,
    trackEnded: stream.getVideoTracks()[0].readyState === 'ended' };
} catch (error) {
  window.__remoteLiteResult = { status: 'FAIL', error: String(error?.message || error) };
} finally { clearInterval(timer); host?.close(); viewer?.close(); }
</script>`;

const source = new URL('../src/remote-lite/', import.meta.url);
const server = createServer(async (request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
    return;
  }
  if (request.url === '/src/remote-lite/browser-webrtc.mjs' || request.url === '/src/remote-lite/manual-protocol.mjs') {
    const name = request.url.split('/').at(-1);
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(await readFile(new URL(name, source)));
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const pageUrl = `http://127.0.0.1:${server.address().port}/`;
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const driverPort = portProbe.address().port;
portProbe.close();
await once(portProbe, 'close');
const driverUrl = `http://127.0.0.1:${driverPort}`;
const driver = spawn(process.env.REMOTE_LITE_CHROMEDRIVER || 'chromedriver', [`--port=${driverPort}`],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
for (const stream of [driver.stdout, driver.stderr]) stream.on('data', chunk => {
  driverLog = (driverLog + chunk.toString()).slice(-4000);
});
const webdriver = async (method, path, body) => {
  let response;
  try {
    response = await fetch(driverUrl + path, { method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new Error(`WebDriver ${method} ${path}: ${error.message}; ChromeDriver: ${driverLog.slice(-1000)}`, { cause: error });
  }
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(result.value?.message || `WebDriver HTTP ${response.status}`);
  return result.value;
};
let sessionId;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (driver.exitCode !== null) throw new Error('ChromeDriver exited: ' + driverLog);
    try { await webdriver('GET', '/status'); ready = true; break; } catch { await pause(250); }
  }
  if (!ready) throw new Error('ChromeDriver did not start: ' + driverLog);
  const session = await webdriver('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new'] },
  } } });
  sessionId = session.sessionId;
  await webdriver('POST', `/session/${sessionId}/url`, { url: pageUrl });
  let result;
  for (let i = 0; i < 60; i++) {
    const json = await webdriver('POST', `/session/${sessionId}/execute/sync`, {
      script: 'return JSON.stringify(window.__remoteLiteResult || null)', args: [],
    });
    result = JSON.parse(json);
    if (result?.status) break;
    await pause(500);
  }
  if (result?.status !== 'PASS' || result.videoWidth < 1 || result.applied !== 1 ||
    result.acknowledged !== 1 || result.trackEnded !== true) {
    throw new Error('Real Chromium RTC smoke failed: ' + JSON.stringify(result));
  }
  process.stdout.write('PASS real Chromium VM WebRTC media/DataChannel, manual ACK, revoked track stop: ' + JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(`FAIL Chromium VM smoke: ${error.message}\n`);
  throw error;
} finally {
  if (sessionId) await webdriver('DELETE', `/session/${sessionId}`).catch(() => {});
  driver.kill();
  server.close();
}
