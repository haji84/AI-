// Disposable Windows VM: drive the embedded localhost preview through its
// fail-closed remote route, real GDI frames, SendInput, and browser WebRTC.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { nativeDocumentState } from './remote-lite-windows-document-state.mjs';
import { navigateWindowsFixture, openWindowsFixtureTab } from './remote-lite-windows-browser-navigation.mjs';

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
let phase = 'driver-start';
const webdriver = async (method, path, body) => {
  // Never print the page URL/body: they contain the local launch capability.
  const route = path.replace(/\/session\/[^/]+/u, '/session/<id>');
  let status = 'unavailable';
  try {
    const response = await fetch(driverUrl + path, { method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    status = response.status;
    const result = await response.json();
    if (!response.ok || result.value?.error) throw new Error('WebDriver response refused');
    return result.value;
  } catch (error) {
    const kind = error?.name === 'TimeoutError' ? 'timeout' : 'request-failed';
    throw new Error(`WebDriver ${method} ${route} phase=${phase} ${kind} HTTP=${status}`);
  }
};
let sessionId;
try {
  let started = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (driver.exitCode !== null) throw new Error('ChromeDriver exited: ' + driverLog);
    try { await webdriver('GET', '/status'); started = true; break; } catch { await pause(250); }
  }
  if (!started) throw new Error('ChromeDriver unavailable: ' + driverLog);
  phase = 'session-creation';
  const session = await webdriver('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'chrome', 'goog:loggingPrefs': { performance: 'ALL' },
    'goog:chromeOptions': { args: ['--headless=new'],
      ...(process.env.REMOTE_LITE_CHROME ? { binary: process.env.REMOTE_LITE_CHROME } : {}),
    },
  } } });
  sessionId = session.sessionId;
  await openWindowsFixtureTab(webdriver, sessionId);
  phase = 'navigation';
  await navigateWindowsFixture(webdriver, sessionId, pageUrl);
  const evalPage = script => webdriver('POST', `/session/${sessionId}/execute/sync`, { script, args: [] });
  phase = 'native-jpeg';
  let loaded = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const state = await evalPage('return { width: document.querySelector("#screen")?.naturalWidth || 0, error: document.querySelector("#error")?.textContent }');
    if (state.width > 0) { loaded = true; break; }
    if (state.error) throw new Error('native frame request failed: ' + state.error);
    await pause(150);
  }
  if (!loaded) {
    const state = await evalPage(`return (${nativeDocumentState.toString()})()`);
    throw new Error('native JPEG did not load: ' + JSON.stringify(state));
  }
  phase = 'rtc-start';
  await evalPage('window.confirm = () => true; document.querySelector("#rtcStart").click(); return true');
  phase = 'rtc-media';
  let mediaReady = false;
  let lastMediaState;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await evalPage('return { text: document.querySelector("#rtcStatus").textContent, width: document.querySelector("#rtcVideo").videoWidth, input: !document.querySelector("#rtcInput").disabled, source: document.querySelector("#sourceCanvas").width, screen: document.querySelector("#screen").naturalWidth, rtc: typeof rtcState === "undefined" || !rtcState ? null : { pong: rtcState.pong, videoReady: rtcState.videoReady, viewer: rtcState.viewer.connectionState, host: rtcState.host.connectionState, channel: rtcState.channel?.readyState } }');
    if (state.rtc) lastMediaState = state;
    if (state.text.startsWith('PASS:') && state.width > 0 && state.input) { mediaReady = true; break; }
    if (/失敗|応答なし|拒否/u.test(state.text)) throw new Error('native WebRTC failed: ' + JSON.stringify({ state, lastMediaState }));
    await pause(150);
  }
  if (!mediaReady) throw new Error('native video/DataChannel did not connect: ' + JSON.stringify(lastMediaState));
  process.stdout.write(JSON.stringify({ event: 'media-ready', nativeJPEG: true, decodedVideo: true }) + '\n');
  const lines = createInterface({ input: process.stdin });
  const commands = lines[Symbol.asyncIterator]();
  const move = await commands.next();
  if (move.value !== 'move') throw new Error('VM cursor setup was not confirmed');
  phase = 'native-input';
  await evalPage('document.querySelector("#rtcInput").click(); return true');
  let inputReady = false;
  for (let attempt = 0; attempt < 70; attempt++) {
    const state = await evalPage('return document.querySelector("#rtcStatus").textContent');
    if (state.includes('Windowsが受理')) { inputReady = true; break; }
    if (state.includes('拒否')) throw new Error('native SendInput refused: ' + state);
    await pause(150);
  }
  if (!inputReady) throw new Error('manual DataChannel input lacked native acknowledgement');
  const refs = await evalPage('window.__vmTrack = rtcState?.stream?.getVideoTracks()[0]; window.__vmChannel = rtcState?.channel; return { track: !!window.__vmTrack, channel: !!window.__vmChannel }');
  if (!refs.track || !refs.channel) throw new Error('VM could not retain live media/channel references');
  process.stdout.write(JSON.stringify({ event: 'active', nativeJPEG: true, decodedVideo: true,
    manualNativeAck: true }) + '\n');
  const revoke = await commands.next();
  if (revoke.value !== 'revoke') throw new Error('VM revocation command missing');
  phase = 'revocation';
  let stopped = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = await evalPage('return { text: document.querySelector("#rtcStatus").textContent, stream: document.querySelector("#rtcVideo").srcObject, image: document.querySelector("#screen").getAttribute("src"), track: window.__vmTrack?.readyState, channel: window.__vmChannel?.readyState }');
    if (state.text.includes('署名付き端末セッション') && state.stream === null && state.image === null &&
      state.track === 'ended' && state.channel === 'closed') {
      stopped = true; break;
    }
    await pause(150);
  }
  if (!stopped) throw new Error('revoked native WebRTC media did not stop');
  // A response already in flight must not repaint the screen after the first
  // empty observation. Keep checking beyond the frame polling interval.
  for (let attempt = 0; attempt < 12; attempt++) {
    await pause(200);
    const state = await evalPage('return { stream: document.querySelector("#rtcVideo").srcObject, image: document.querySelector("#screen").getAttribute("src"), track: window.__vmTrack?.readyState, channel: window.__vmChannel?.readyState }');
    if (state.stream !== null || state.image !== null || state.track !== 'ended' || state.channel !== 'closed') {
      throw new Error('revoked media reappeared after stop');
    }
  }
  process.stdout.write(JSON.stringify({ event: 'stopped', revokedVideoClosed: true }) + '\n');
} catch (error) {
  process.stderr.write(`FAIL Windows native browser VM: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
} finally {
  phase = 'cleanup';
  if (sessionId) await webdriver('DELETE', `/session/${sessionId}`).catch(() => {});
  driver.kill();
}
