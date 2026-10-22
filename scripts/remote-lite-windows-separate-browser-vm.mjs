// Disposable Windows VM: two independent Chromium browser sessions, one
// native Windows host and one test-only viewer. No public listener or account.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { compareFrameHistory, installFrameDrawProbe, nativeCopyPixelProbeScript } from './remote-lite-vm-pixels.mjs';
import { nativeDocumentState } from './remote-lite-windows-document-state.mjs';
import { navigateWindowsFixture, openWindowsFixtureTab } from './remote-lite-windows-browser-navigation.mjs';

const [hostUrl, viewerUrl] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{64}&remote=1$/u.test(hostUrl || '') ||
  !/^http:\/\/127\.0\.0\.1:\d+\/vm\/viewer$/u.test(viewerUrl || '')) {
  throw new Error('disposable loopback VM pages required');
}
const pause = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms));
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
  // Driver errors can echo navigation arguments containing the launch token.
  // Retain only the method, redacted endpoint, HTTP status and failure kind.
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
    throw new Error(`WebDriver ${method} ${route} ${kind} HTTP=${status}`);
  }
};
const sessions = [];
try {
  let started = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (driver.exitCode !== null) throw new Error('ChromeDriver exited: ' + driverLog);
    try { await webdriver('GET', '/status'); started = true; break; } catch { await pause(250); }
  }
  if (!started) throw new Error('ChromeDriver unavailable: ' + driverLog);
  const newSession = async url => {
    const session = await webdriver('POST', '/session', { capabilities: { alwaysMatch: {
      browserName: 'chrome', 'goog:loggingPrefs': { performance: 'ALL' },
      'goog:chromeOptions': { args: ['--headless=new'],
        ...(process.env.REMOTE_LITE_CHROME ? { binary: process.env.REMOTE_LITE_CHROME } : {}),
      },
    } } });
    sessions.push(session.sessionId);
    await openWindowsFixtureTab(webdriver, session.sessionId);
    await navigateWindowsFixture(webdriver, session.sessionId, url);
    return session.sessionId;
  };
  const evalPage = (id, script) => webdriver('POST', `/session/${id}/execute/sync`, { script, args: [] });
  const host = await newSession(hostUrl);
  // Record only after the page has painted the JPEG into the capture canvas.
  // Copy at native size before sampling so JPEG, canvas and video use the same
  // downsampling path; direct 12x7 sampling gave a false 46.6 RGB difference.
  const nativeSnapshot = nativeCopyPixelProbeScript('#screen', '#sourceCanvas');
  let probeInstalled = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    probeInstalled = await evalPage(host, `window.vmNativeFrameSamples=[];
    return (${installFrameDrawProbe.toString()})(
      document.querySelector('#screen'),document.querySelector('#sourceCanvas'),()=>{
        const [nativeImage,nativeCanvas]=(()=>{${nativeSnapshot}})();
        if(nativeImage&&nativeCanvas){window.vmNativeFrameSamples.push({image:nativeImage,canvas:nativeCanvas});
          if(window.vmNativeFrameSamples.length>20)window.vmNativeFrameSamples.shift();}
      });`);
    if (probeInstalled) break;
    await pause(100);
  }
  if (!probeInstalled) {
    const state = await evalPage(host, `return (${nativeDocumentState.toString()})()`);
    throw new Error('Host document did not expose the native frame surface: ' + JSON.stringify(state));
  }
  let frameReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await evalPage(host, 'return {width:document.querySelector("#screen")?.naturalWidth||0,error:document.querySelector("#error")?.textContent}');
    if (state.width > 0) { frameReady = true; break; }
    if (state.error) throw new Error('native frame refused: ' + state.error);
    await pause(150);
  }
  if (!frameReady) throw new Error('native screen unavailable');
  await evalPage(host, 'document.querySelector("#remotePeerStart").click();return true');
  const viewer = await newSession(viewerUrl);
  let mediaReady = false;
  let lastState;
  for (let attempt = 0; attempt < 130; attempt++) {
    const state = await evalPage(viewer, 'return {width:document.querySelector("#remoteVideo")?.videoWidth||0,status:document.querySelector("#viewerStatus")?.textContent,connected:window.vmViewer?.connected||false}');
    lastState = state;
    if (state.width > 0 && state.connected) { mediaReady = true; break; }
    if (/failed|refused|closed/u.test(state.status || '')) throw new Error('viewer refused: ' + JSON.stringify(state));
    await pause(150);
  }
  if (!mediaReady) throw new Error('separate browser media not decoded: ' + JSON.stringify(lastState));
  // A decoded video width alone can pass with black frames. Compare recent
  // GDI/Canvas frame generations against the separately decoded viewer video.
  let matchedPixels = false;
  let lastNativePixels;
  for (let attempt = 0; attempt < 60; attempt++) {
    const nativeFrames = await evalPage(host, 'return window.vmNativeFrameSamples');
    const nativeVideo = await evalPage(viewer, nativeCopyPixelProbeScript('#remoteVideo'));
    lastNativePixels = compareFrameHistory(nativeFrames, nativeVideo);
    if (lastNativePixels.matched) {
      matchedPixels = true; break;
    }
    await pause(150);
  }
  if (!matchedPixels) throw new Error('native GDI pixels did not reach separate viewer: ' + JSON.stringify(lastNativePixels));
  process.stdout.write(JSON.stringify({event:'media-ready', separateBrowsers:true,
    width:lastState.width, pixelsMatched:true}) + '\n');
  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  if ((await lines.next()).value !== 'move') throw new Error('VM cursor setup missing');
  const sequence = await evalPage(viewer, 'return window.vmViewer.sendManual({action:"pointer",phase:"move",button:"left",x:.5,y:.5})');
  if (sequence !== 1) throw new Error('manual input sequence was not one');
  let acknowledged = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const status = await evalPage(viewer, 'return document.querySelector("#viewerStatus").textContent');
    if (status === 'manual-ack:1') { acknowledged = true; break; }
    if (/failed|refused|closed/u.test(status)) throw new Error('manual input refused: ' + status);
    await pause(150);
  }
  if (!acknowledged) throw new Error('native input acknowledgement absent');
  const refs = await evalPage(viewer, 'window.vmViewerTrack=document.querySelector("#remoteVideo").srcObject?.getVideoTracks()[0];return {track:window.vmViewerTrack?.readyState,channel:window.vmViewerChannel?.readyState}');
  if (refs.track !== 'live' || refs.channel !== 'open') throw new Error('separate viewer did not retain live media and control references');
  process.stdout.write(JSON.stringify({event:'manual-ack', nativeInput:true}) + '\n');
  if ((await lines.next()).value !== 'revoke') throw new Error('VM revocation missing');
  let stopped = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const owner = await evalPage(host, 'return {status:document.querySelector("#remotePeerStatus").textContent,image:document.querySelector("#screen").getAttribute("src")}');
    const remote = await evalPage(viewer, 'return {closed:window.vmViewer.closed,video:document.querySelector("#remoteVideo").srcObject,track:window.vmViewerTrack?.readyState,channel:window.vmViewerChannel?.readyState}');
    if ((/session-not-active|screen-stopped|signed-signaling-unavailable/u.test(owner.status)) && owner.image === null &&
      remote.closed && remote.video === null && remote.track === 'ended' && remote.channel === 'closed') {
      stopped = true; break;
    }
    await pause(150);
  }
  if (!stopped) throw new Error('revoked signed host retained separate viewer media or input channel');
  for (let attempt = 0; attempt < 12; attempt++) {
    await pause(200);
    const owner = await evalPage(host, 'return {image:document.querySelector("#screen").getAttribute("src")}');
    const remote = await evalPage(viewer, 'return {closed:window.vmViewer.closed,video:document.querySelector("#remoteVideo").srcObject,track:window.vmViewerTrack?.readyState,channel:window.vmViewerChannel?.readyState}');
    if (owner.image !== null || !remote.closed || remote.video !== null ||
      remote.track !== 'ended' || remote.channel !== 'closed') throw new Error('revoked media or input reappeared');
  }
  const postStopInput = await evalPage(viewer, 'try{window.vmViewer.sendManual({action:"pointer",phase:"move",button:"left",x:.1,y:.1});return "accepted"}catch(error){return error.code||error.message}');
  if (postStopInput === 'accepted') throw new Error('revoked viewer accepted manual input');
  process.stdout.write(JSON.stringify({event:'stopped', revokedHost:true, revokedViewer:true}) + '\n');
} catch (error) {
  process.stderr.write(`FAIL separate-browser Windows VM: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
} finally {
  for (const id of sessions) await webdriver('DELETE', `/session/${id}`).catch(() => {});
  driver.kill();
}
