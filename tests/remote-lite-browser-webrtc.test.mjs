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
function fixture() {
  const peerViewer = new FakeRtc(), peerHost = new FakeRtc();
  peerViewer.partner = peerHost;
  peerHost.partner = peerViewer;
  const viewerSignals = [], hostSignals = [], commands = [], streams = [], states = [];
  let consent = 0, stopped = 0;
  const track = { kind: 'video', readyState: 'live', addEventListener() {}, stop() { stopped++; } };
  const screen = { getVideoTracks: () => [track], getTracks: () => [track] };
  const host = new BrowserManualPeer({
    role: 'host', rtcFactory: () => peerHost, iceServers: [],
    sendSignal: signal => hostSignals.push(signal),
    requestScreen: async () => { consent++; return screen; },
    onManualInput: command => commands.push(command),
    onState: value => states.push(value),
  });
  const viewer = new BrowserManualPeer({
    role: 'viewer', rtcFactory: () => peerViewer, iceServers: [],
    sendSignal: signal => viewerSignals.push(signal),
    onStream: stream => streams.push(stream),
    onState: value => states.push(value),
  });
  const connect = async () => {
    await host.approveLocalScreen();
    await viewer.startViewer();
    await host.receiveSignal(viewerSignals.shift());
    await viewer.receiveSignal(hostSignals.shift());
  };
  return { peerHost, peerViewer, host, viewer, viewerSignals, hostSignals,
    commands, streams, states, connect, screen, getConsent: () => consent, getStopped: () => stopped };
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
  assert.deepEqual(f.commands, [{ action:'tap', x:0.5, y:0.6 }]);
  assert.equal(f.viewer.sendManual({ action:'key', key:'HOME' }), 2);
  assert.deepEqual(f.commands[1], { action:'key', key:'HOME' });
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
    requestScreen:async()=>null});
  await assert.rejects(()=>h.approveLocalScreen(),/SCREEN_CONSENT_REQUIRED/);
  assert.equal(peer.tracks.length,0);
  h.close();
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
