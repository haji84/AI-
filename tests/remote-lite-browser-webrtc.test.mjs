import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserManualPeer } from '../src/remote-lite/browser-webrtc.mjs';

class Channel {
  constructor(label) { this.label = label; this.readyState = 'open'; this.bufferedAmount = 0; this.messages = []; }
  send(message) { this.messages.push(message); this.partner?.onmessage?.({ data: message }); }
  close() { this.readyState = 'closed'; }
}
class FakeRtc {
  connectionState = 'connected';
  localDescription = null;
  remoteDescription = null;
  tracks = [];
  candidates = [];
  constructor() { this.channel = null; this.partner = null; }
  createDataChannel(label) { this.channel = new Channel(label); return this.channel; }
  addTransceiver(kind, options) { this.transceiver = { kind, options }; }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\na=answer' }; }
  async setLocalDescription(desc) { this.localDescription = desc; }
  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    if (desc.type === 'offer' && this.partner?.channel) {
      const incoming = new Channel('goriq-manual-v1');
      incoming.partner = this.partner.channel;
      this.partner.channel.partner = incoming;
      this.ondatachannel?.({ channel: incoming });
    }
    if (desc.type === 'answer' && this.partner?.tracks?.length) {
      const { track, stream } = this.partner.tracks[0];
      this.ontrack?.({ track, streams: [stream] });
    }
  }
  async addIceCandidate(candidate) { this.candidates.push(candidate); }
  addTrack(track, stream) { this.tracks.push({ track, stream }); }
  close() { this.connectionState = 'closed'; }
}
function fixture({ applyInput, checkSession = () => true, waitForManualAck = false,
  canSendManual = () => true } = {}) {
  const peerViewer = new FakeRtc(), peerHost = new FakeRtc();
  peerViewer.partner = peerHost;
  peerHost.partner = peerViewer;
  const viewerSignals = [], hostSignals = [], commands = [], streams = [], states = [], acknowledgements = [];
  let consent = 0, stopped = 0;
  const track = { kind: 'video', readyState: 'live', addEventListener() {}, stop() { stopped++; } };
  const screen = { getVideoTracks: () => [track], getTracks: () => [track] };
  const host = new BrowserManualPeer({
    role: 'host', rtcFactory: () => peerHost, iceServers: [],
    sendSignal: signal => hostSignals.push(signal),
    checkSession,
    requestScreen: async () => { consent++; return screen; },
    onManualInput: command => { commands.push(command); return applyInput ? applyInput(command) : true; },
    onState: value => states.push(value),
  });
  const viewer = new BrowserManualPeer({
    role: 'viewer', rtcFactory: () => peerViewer, iceServers: [],
    waitForManualAck, canSendManual,
    sendSignal: signal => viewerSignals.push(signal),
    onStream: stream => streams.push(stream),
    onManualAcknowledged: sequence => acknowledgements.push(sequence),
    onState: value => states.push(value),
  });
  const connect = async () => {
    await host.approveLocalScreen();
    await viewer.startViewer();
    await host.receiveSignal(viewerSignals.shift());
    await viewer.receiveSignal(hostSignals.shift());
  };
  return { peerHost, peerViewer, host, viewer, viewerSignals, hostSignals,
    commands, streams, states, acknowledgements, connect, screen, getConsent: () => consent, getStopped: () => stopped };
}

test('browser peer blocks host offer until local screen permission', async () => {
  const f = fixture();
  await f.viewer.startViewer();
  await assert.rejects(() => f.host.receiveSignal(f.viewerSignals.shift()), /HOST_CONSENT_FIRST/);
  assert.equal(f.getConsent(), 0);
  assert.equal(f.commands.length, 0);
  f.viewer.close(); f.host.close();
});

test('browser peer establishes SDP, approved video track and manual input data channel', async () => {
  const f = fixture();
  await f.connect();
  assert.equal(f.getConsent(), 1);
  assert.equal(f.peerHost.tracks.length, 1);
  assert.equal(f.streams[0], f.screen);
  assert.equal(f.viewer.connected, true);
  assert.equal(f.host.connected, true);
  assert.equal(f.viewer.sendManual({ action:'tap', x:0.5, y:0.6 }), 1);
  await new Promise(resolve => globalThis.setImmediate(resolve));
  assert.deepEqual(f.commands, [{ action:'tap', x:0.5, y:0.6 }]);
  assert.equal(f.viewer.sendManual({ action:'key', key:'HOME' }), 2);
  await new Promise(resolve => globalThis.setImmediate(resolve));
  assert.deepEqual(f.commands[1], { action:'key', key:'HOME' });
  assert.deepEqual(f.acknowledgements, [1, 2]);
  f.viewer.close();
  f.host.close();
  assert.equal(f.getStopped(), 1);
});

test('manual control is never accepted without connected channel and user permission', async () => {
  const f = fixture();
  assert.throws(() => f.viewer.sendManual({action:'tap',x:0.2,y:0.2}),/NOT_CONNECTED/);
  await f.connect();
  assert.throws(() => f.viewer.sendManual({action:'shell',command:'whoami'}),/INVALID_MANUAL_MESSAGE/);
  assert.equal(f.commands.length, 0);
  f.host.close();
  assert.equal(f.host.closed, true);
  // An already-established browser data channel cannot bypass disabled local control.
  f.peerViewer.channel.send(JSON.stringify({sequence:1,command:{action:'tap',x:0.5,y:0.5}}));
  assert.equal(f.commands.length, 0);
  f.viewer.close();
});

test('manual peer discards malformed, nonsequential, extra-authority inputs', async () => {
  const f=fixture();
  await f.connect();
  const ch=f.peerViewer.channel;
  for(const message of ['not json',
    JSON.stringify({sequence:2,command:{action:'tap',x:0.5,y:0.5}}),
    JSON.stringify({sequence:1,command:{action:'auto',goal:'do everything'}}),
    JSON.stringify({sequence:1,command:{action:'tap',x:0.5,y:0.5},authorization:'admin'}),
    JSON.stringify({sequence:1,command:{action:'tap',x:0.5,y:0.5,run:'shell'}})]) ch.send(message);
  assert.equal(f.commands.length,0);
  ch.send(JSON.stringify({sequence:1,command:{action:'tap',x:0.4,y:0.4}}));
  await new Promise(resolve => globalThis.setImmediate(resolve));
  assert.equal(f.commands.length,1);
  ch.send(JSON.stringify({sequence:1,command:{action:'tap',x:0.4,y:0.4}}));
  assert.equal(f.commands.length,1);
  f.host.close();f.viewer.close();
});

test('ICE candidate arriving before SDP is queued, then applied after SDP', async () => {
  const f=fixture();
  await f.host.approveLocalScreen();
  await f.host.receiveSignal({type:'candidate',candidate:'candidate:1',sdpMid:'0',sdpMLineIndex:0});
  assert.equal(f.peerHost.candidates.length,0);
  await f.viewer.startViewer();
  await f.host.receiveSignal(f.viewerSignals.shift());
  assert.equal(f.peerHost.candidates.length,1);
  await f.viewer.receiveSignal(f.hostSignals.shift());
  f.host.close();f.viewer.close();
});

test('screen capture error cannot silently become permission grant', async () => {
  const peer = new FakeRtc();
  const h=new BrowserManualPeer({role:'host',rtcFactory:()=>peer,sendSignal:()=>{},
    checkSession:()=>true, requestScreen:async()=>null});
  await assert.rejects(()=>h.approveLocalScreen(),/SCREEN_CONSENT_REQUIRED/);
  assert.equal(peer.tracks.length,0);
  h.close();
});

test('closing while screen consent is pending stops a late capture', async () => {
  let completeConsent;
  let stopped = 0;
  const track = { kind: 'video', readyState: 'live', addEventListener() {}, stop() { stopped++; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const peer = new FakeRtc();
  const host = new BrowserManualPeer({ role: 'host', rtcFactory: () => peer,
    sendSignal: () => {}, checkSession: () => true,
    requestScreen: () => new Promise(resolve => { completeConsent = resolve; }) });
  const pending = host.approveLocalScreen();
  await new Promise(resolve => globalThis.setImmediate(resolve));
  host.close('session-revoked');
  completeConsent(stream);
  await assert.rejects(pending, /CLOSED/);
  assert.equal(stopped, 1);
  assert.equal(peer.tracks.length, 0);
});

test('concurrent screen approval cannot start two captures', async () => {
  let finishConsent;
  let requests = 0;
  let stopped = 0;
  const track = { kind: 'video', readyState: 'live', addEventListener() {}, stop() { stopped++; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const peer = new FakeRtc();
  const host = new BrowserManualPeer({ role: 'host', rtcFactory: () => peer,
    sendSignal: () => {}, checkSession: () => true,
    requestScreen: () => { requests++; return new Promise(resolve => { finishConsent = resolve; }); } });
  const pending = host.approveLocalScreen();
  await new Promise(resolve => globalThis.setImmediate(resolve));
  await assert.rejects(() => host.approveLocalScreen(), /INVALID_STATE/);
  finishConsent(stream);
  await pending;
  assert.equal(requests, 1);
  assert.equal(peer.tracks.length, 1);
  host.close();
  assert.equal(stopped, 1);
});

test('screen permission request starts synchronously during the user gesture', async () => {
  let inGesture = true;
  let requestedInGesture = false;
  const track = { kind: 'video', readyState: 'live', addEventListener() {}, stop() {} };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const host = new BrowserManualPeer({ role: 'host', rtcFactory: () => new FakeRtc(),
    sendSignal: () => {}, checkSession: async () => true,
    requestScreen: () => { requestedInGesture = inGesture; return Promise.resolve(stream); } });
  const pending = host.approveLocalScreen();
  inGesture = false;
  await pending;
  assert.equal(requestedInGesture, true);
  host.close();
});

test('manual input is acknowledged only after host application succeeds', async () => {
  let finishInput;
  const f = fixture({ applyInput: () => new Promise(resolve => { finishInput = resolve; }) });
  await f.connect();
  f.viewer.sendManual({ action: 'tap', x: 0.4, y: 0.6 });
  await new Promise(resolve => globalThis.setImmediate(resolve));
  assert.deepEqual(f.acknowledgements, []);
  finishInput(true);
  await new Promise(resolve => globalThis.setImmediate(resolve));
  assert.deepEqual(f.acknowledgements, [1]);
  f.host.close(); f.viewer.close();
});

test('ACK-paced viewer sends the next input only after the preceding OS result', async () => {
  const completions = [];
  const f = fixture({ waitForManualAck: true,
    applyInput: () => new Promise(resolve => completions.push(resolve)) });
  try {
    await f.connect();
    assert.equal(f.viewer.sendManual({ action: 'tap', x: .2, y: .3 }), 1);
    assert.equal(f.viewer.sendManual({ action: 'tap', x: .4, y: .5 }), 2);
    assert.equal(f.peerViewer.channel.messages.length, 1, 'second packet must remain at viewer');
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.equal(f.commands.length, 1);
    completions.shift()(true);
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.equal(f.peerViewer.channel.messages.length, 2);
    assert.equal(f.commands.length, 2);
    assert.deepEqual(f.acknowledgements, [1]);
    completions.shift()(true);
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.deepEqual(f.acknowledgements, [1, 2]);
  } finally { f.viewer.close(); f.host.close(); }
});

test('ACK-paced viewer never sends an input that expired in its local queue', async t => {
  let now = 1000, finish;
  t.mock.method(globalThis.performance, 'now', () => now);
  const f = fixture({ waitForManualAck: true,
    applyInput: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await f.connect();
    f.viewer.sendManual({ action: 'tap', x: .2, y: .3 });
    f.viewer.sendManual({ action: 'tap', x: .4, y: .5 });
    await new Promise(resolve => globalThis.setImmediate(resolve));
    now = 2001;
    finish(true);
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.equal(f.viewer.closed, true);
    assert.ok(f.states.includes('manual-input-stale'));
    assert.equal(f.peerViewer.channel.messages.length, 1);
    assert.equal(f.commands.length, 1);
  } finally { f.viewer.close(); f.host.close(); }
});

test('closing an ACK-paced viewer discards queued input even after a late ACK', async () => {
  let finish;
  const f = fixture({ waitForManualAck: true,
    applyInput: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await f.connect();
    f.viewer.sendManual({ action: 'tap', x: .2, y: .3 });
    f.viewer.sendManual({ action: 'tap', x: .4, y: .5 });
    await new Promise(resolve => globalThis.setImmediate(resolve));
    f.viewer.close();
    finish(true);
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.equal(f.peerViewer.channel.messages.length, 1);
    assert.equal(f.commands.length, 1);
  } finally { f.viewer.close(); f.host.close(); }
});

test('queued input rechecks the viewer media/visibility gate at actual transmission', async () => {
  let allowed = true, finish;
  const f = fixture({ waitForManualAck: true, canSendManual: () => allowed,
    applyInput: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await f.connect();
    f.viewer.sendManual({ action: 'tap', x: .2, y: .3 });
    f.viewer.sendManual({ action: 'tap', x: .4, y: .5 });
    await new Promise(resolve => globalThis.setImmediate(resolve));
    allowed = false;
    finish(true);
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.equal(f.viewer.closed, true);
    assert.ok(f.states.includes('manual-input-not-allowed'));
    assert.equal(f.peerViewer.channel.messages.length, 1);
    assert.equal(f.commands.length, 1);
  } finally { f.viewer.close(); f.host.close(); }
});

test('ACK-paced queue is bounded and cannot acknowledge an unsent packet', async () => {
  const f = fixture({ waitForManualAck: true, applyInput: () => new Promise(() => {}) });
  try {
    await f.connect();
    for (let i = 0; i < 17; i++) f.viewer.sendManual({ action: 'tap', x: .2, y: .3 });
    assert.equal(f.peerViewer.channel.messages.length, 1);
    assert.throws(() => f.viewer.sendManual({ action: 'tap', x: .4, y: .5 }), /CHANNEL_BACKPRESSURE/);
    assert.equal(f.viewer.closed, true);
    assert.ok(f.states.includes('manual-input-queue-full'));
  } finally { f.viewer.close(); f.host.close(); }
  const g = fixture({ waitForManualAck: true, applyInput: () => new Promise(() => {}) });
  try {
    await g.connect();
    g.viewer.sendManual({ action: 'tap', x: .2, y: .3 });
    g.viewer.sendManual({ action: 'tap', x: .4, y: .5 });
    // Packet2 has an allocated sequence but has never crossed the channel.
    g.peerViewer.channel.onmessage({ data: JSON.stringify({ type: 'manual-applied', sequence: 2 }) });
    assert.equal(g.peerViewer.channel.messages.length, 1);
    assert.equal(g.viewer.closed, true);
    assert.ok(g.states.includes('manual-ack-invalid'));
  } finally { g.viewer.close(); g.host.close(); }
});

test('refused manual input closes host without a false acknowledgement', async () => {
  const f = fixture({ applyInput: async () => false });
  await f.connect();
  f.viewer.sendManual({ action: 'tap', x: 0.4, y: 0.6 });
  await new Promise(resolve => globalThis.setImmediate(resolve));
  assert.deepEqual(f.acknowledgements, []);
  assert.equal(f.host.closed, true);
  assert.equal(f.getStopped(), 1);
  f.viewer.close();
});

test('host rejects a burst beyond 30 valid manual inputs per second', async () => {
  const f = fixture();
  await f.connect();
  for (let sequence = 1; sequence <= 31; sequence++) {
    f.peerViewer.channel.send(JSON.stringify({ sequence, command: { action: 'tap', x: 0.5, y: 0.5 } }));
  }
  await new Promise(resolve => globalThis.setImmediate(resolve));
  assert.equal(f.host.closed, true);
  assert.ok(f.commands.length <= 30);
  assert.equal(f.getStopped(), 1);
  f.viewer.close();
});

test('revoked session stops an established screen and blocks further input', async () => {
  let active = true;
  const f = fixture({ checkSession: () => active });
  await f.connect();
  active = false;
  assert.equal(await f.host.verifySession(), false);
  f.viewer.sendManual({ action: 'tap', x: 0.5, y: 0.5 });
  await new Promise(resolve => globalThis.setImmediate(resolve));
  assert.equal(f.host.closed, true);
  assert.equal(f.getStopped(), 1);
  assert.deepEqual(f.commands, []);
  f.viewer.close();
});

test('host refuses to capture when the session cannot be confirmed', async () => {
  const f = fixture({ checkSession: () => false });
  await assert.rejects(() => f.host.approveLocalScreen(), /SESSION_NOT_ACTIVE/);
  assert.equal(f.getConsent(), 1);
  assert.equal(f.getStopped(), 1);
  assert.equal(f.peerHost.tracks.length, 0);
  f.host.close(); f.viewer.close();
});

test('invalid ICE configuration, signaling order, and a second attempt fail safely',async()=>{
  assert.throws(()=>new BrowserManualPeer({role:'viewer',rtcFactory:()=>new FakeRtc(),
    sendSignal:()=>{},iceServers:[{urls:['http://example.org']}] }),/ICE_CONFIG_INVALID/);
  const f=fixture();
  await assert.rejects(()=>f.viewer.receiveSignal({type:'answer',sdp:'v=0\r\n'}),/UNEXPECTED_ANSWER/);
  await f.connect();
  await assert.rejects(()=>f.viewer.startViewer(),/INVALID_STATE/);
  await assert.rejects(()=>f.viewer.receiveSignal({type:'answer',sdp:'v=0\r\n'}),/UNEXPECTED_ANSWER/);
  f.host.close();f.viewer.close();
});

test('connection loss immediately terminates screen capture and manual session',async()=>{
  const f=fixture();
  await f.connect();
  f.peerHost.connectionState='disconnected';
  f.peerHost.onconnectionstatechange();
  assert.equal(f.host.closed,true);
  assert.equal(f.getStopped(),1);
  assert.equal(f.commands.length,0);
  f.viewer.close();
});

test('control channel loss stops host screen capture', async () => {
  const f = fixture();
  await f.connect();
  f.peerViewer.channel.partner.onclose();
  assert.equal(f.host.closed, true);
  assert.equal(f.getStopped(), 1);
  f.viewer.close();
});
