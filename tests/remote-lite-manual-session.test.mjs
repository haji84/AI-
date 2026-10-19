import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualRemoteSessionStore, RemoteLiteProtocolError } from '../src/remote-lite/manual-session.mjs';
import { parseManualInput, parseWebRtcSignal } from '../src/remote-lite/manual-protocol.mjs';

function rig() {
  let ms = 1_000_000;
  const ownership = new Map([['android-1', 'friend-a'], ['windows-1', 'friend-a'], ['android-2', 'friend-b']]);
  const deviceIdentities = new Map([['android-1', 'signed-android-1'], ['windows-1', 'signed-windows-1'], ['android-2', 'signed-android-2']]);
  const store = new ManualRemoteSessionStore({
    now: () => ms,
    authenticateViewer: ({ viewerId, deviceId }) => ownership.get(deviceId) === viewerId,
    authenticateDevice: ({ deviceId, devicePrincipalId }) => deviceIdentities.get(deviceId) === devicePrincipalId,
  });
  const request = (deviceId = 'android-1') => store.request({ viewerId: 'friend-a', deviceId });
  const accept = (sessionId, deviceId = 'android-1') => store.accept({ sessionId, deviceId, devicePrincipalId: deviceIdentities.get(deviceId) });
  return { store, ownership, request, accept, advance: (n) => { ms += n; } };
}

test('requires independent authenticated viewer and device identity callbacks', () => {
  assert.throws(() => new ManualRemoteSessionStore(), TypeError);
  assert.throws(() => new ManualRemoteSessionStore({ authenticateViewer: () => true }), TypeError);
});

test('owner-separated request creates an unaccepted, single-controller session', () => {
  const { store, request } = rig();
  const s = request();
  assert.match(s.sessionId, /^[\da-f-]{36}$/);
  assert.match(s.viewerToken, /^[0-9a-f]{64}$/);
  assert.equal(store.status({ sessionId: s.sessionId, viewerId: 'friend-a', viewerToken: s.viewerToken }).status, 'pending');
  assert.throws(() => request(), /DEVICE_ALREADY_CONTROLLED/);
  assert.throws(() => store.request({ viewerId: 'friend-a', deviceId: 'android-2' }), /VIEWER_NOT_AUTHORIZED/);
  assert.throws(() => store.request({ viewerId: 'friend-b', deviceId: 'windows-1' }), /VIEWER_NOT_AUTHORIZED/);
});

test('real device identity must accept; pending session rejects all input and signaling', () => {
  const { store, request, accept } = rig();
  const s = request();
  const actor = { sessionId: s.sessionId, viewerId: 'friend-a', viewerToken: s.viewerToken };
  assert.throws(() => store.input({ ...actor, sequence: 1, command: { action: 'tap', x: 0.5, y: 0.5 } }), /SESSION_NOT_ACTIVE/);
  assert.throws(() => store.signal({ sessionId: s.sessionId, from: 'viewer', identityId: 'friend-a', viewerToken: s.viewerToken, signal: { type: 'offer', sdp: 'v=0\r\n' } }), /SESSION_NOT_ACTIVE/);
  assert.throws(() => store.accept({ sessionId: s.sessionId, deviceId: 'android-1', devicePrincipalId: 'forged-device' }), /DEVICE_NOT_AUTHORIZED/);
  assert.throws(() => accept(s.sessionId, 'windows-1'), /DEVICE_NOT_AUTHORIZED/);
  assert.equal(accept(s.sessionId).status, 'active');
  assert.throws(() => accept(s.sessionId), /SESSION_NOT_PENDING/);
});

test('manual-only input is bounded, sequenced, identity-bound, and cannot run jobs', () => {
  const { store, request, accept, ownership } = rig();
  const s = request();
  accept(s.sessionId);
  const input = (sequence, command, viewerId = 'friend-a', token = s.viewerToken) => store.input({ sessionId: s.sessionId, viewerId, viewerToken: token, sequence, command });
  assert.throws(() => input(1, { action: 'tap', x: 0.5, y: 0.5 }, 'friend-b'), /VIEWER_NOT_AUTHORIZED/);
  assert.throws(() => input(1, { action: 'tap', x: 0.5, y: 0.5 }, 'friend-a', '0'.repeat(64)), /VIEWER_NOT_AUTHORIZED/);
  assert.throws(() => input(1, { action: 'run-shell', command: 'whoami' }), RemoteLiteProtocolError);
  assert.throws(() => input(1, { action: 'tap', x: 0.5, y: 0.5, script: 'x' }), RemoteLiteProtocolError);
  assert.throws(() => input(1, { action: 'auto', goal: 'operate forever' }), RemoteLiteProtocolError);
  assert.throws(() => input(1, { action: 'swipe', x1: 0, y1: 0, x2: 1, y2: 1, durationMs: 50_000 }), RemoteLiteProtocolError);
  const result = input(1, { action: 'tap', x: 0.5, y: 0.5 });
  assert.equal(result.deviceId, 'android-1');
  assert.deepEqual(result.command, { action: 'tap', x: 0.5, y: 0.5 });
  assert.throws(() => input(1, { action: 'tap', x: 0.5, y: 0.5 }), /INPUT_SEQUENCE_INVALID/);
  assert.throws(() => input(3, { action: 'tap', x: 0.5, y: 0.5 }), /INPUT_SEQUENCE_INVALID/);
  ownership.set('android-1', 'friend-b');
  assert.throws(() => input(2, { action: 'tap', x: 0.5, y: 0.5 }), /VIEWER_NOT_AUTHORIZED/);
});

test('signaling enforces viewer/device direction, bounds and sender isolation', () => {
  const { store, request, accept } = rig();
  const s = request(); accept(s.sessionId);
  const offer = { type: 'offer', sdp: 'v=0\r\n' };
  assert.throws(() => store.signal({ sessionId: s.sessionId, from: 'device', identityId: 'signed-android-1', signal: offer }), /SIGNAL_DIRECTION_INVALID/);
  assert.throws(() => store.signal({ sessionId: s.sessionId, from: 'device', identityId: 'signed-android-2', signal: { type: 'answer', sdp: 'v=0\r\n' } }), /DEVICE_NOT_AUTHORIZED/);
  store.signal({ sessionId: s.sessionId, from: 'viewer', identityId: 'friend-a', viewerToken: s.viewerToken, signal: offer });
  assert.deepEqual(store.receiveSignals({ sessionId: s.sessionId, as: 'device', identityId: 'signed-android-1' }), [offer]);
  assert.deepEqual(store.receiveSignals({ sessionId: s.sessionId, as: 'device', identityId: 'signed-android-1' }), []);
  store.signal({ sessionId: s.sessionId, from: 'device', identityId: 'signed-android-1', signal: { type: 'answer', sdp: 'v=0\r\n' } });
  assert.deepEqual(store.receiveSignals({ sessionId: s.sessionId, as: 'viewer', identityId: 'friend-a', viewerToken: s.viewerToken }), [{ type: 'answer', sdp: 'v=0\r\n' }]);
  assert.throws(() => store.signal({ sessionId: s.sessionId, from: 'viewer', identityId: 'friend-a', viewerToken: s.viewerToken, signal: { type: 'candidate', candidate: 'a'.repeat(5000), sdpMid: null, sdpMLineIndex: 0 } }), RemoteLiteProtocolError);
});

test('expiry, closing and different-device replay fail closed and release device lock', () => {
  const { store, request, accept, advance } = rig();
  const s = request();
  advance(60_001);
  assert.throws(() => accept(s.sessionId), /SESSION_NOT_FOUND_OR_EXPIRED/);
  const s2 = request(); accept(s2.sessionId);
  const actor = { sessionId: s2.sessionId, viewerId: 'friend-a', viewerToken: s2.viewerToken };
  assert.deepEqual(store.status(actor).status, 'active');
  assert.throws(() => store.close({ sessionId: s2.sessionId, as: 'device', identityId: 'signed-windows-1' }), /DEVICE_NOT_AUTHORIZED/);
  assert.equal(store.close({ sessionId: s2.sessionId, as: 'viewer', identityId: 'friend-a', viewerToken: s2.viewerToken }).status, 'closed');
  assert.throws(() => store.status(actor), /SESSION_NOT_FOUND_OR_EXPIRED/);
  assert.doesNotThrow(() => request());
});

test('session active idle timeout is capped by absolute timeout, no implicit continuation', () => {
  const { store, request, accept, advance } = rig();
  const s = request(); accept(s.sessionId);
  advance(9 * 60_000);
  store.input({ sessionId: s.sessionId, viewerId: 'friend-a', viewerToken: s.viewerToken, sequence: 1, command: { action: 'key', key: 'HOME' } });
  advance(10 * 60_000 + 1);
  assert.throws(() => store.status({ sessionId: s.sessionId, viewerId: 'friend-a', viewerToken: s.viewerToken }), /SESSION_NOT_FOUND_OR_EXPIRED/);
});

test('parse contract rejects invalid numeric, unknown action and signal metadata', () => {
  assert.deepEqual(parseManualInput({ action: 'pointer', x: 0.1, y: 0.2, button: 'left', phase: 'down' }).action, 'pointer');
  assert.throws(() => parseManualInput({ action: 'tap', x: NaN, y: 0.1 }), RemoteLiteProtocolError);
  assert.throws(() => parseManualInput({ action: 'text', text: 'a'.repeat(513) }), RemoteLiteProtocolError);
  assert.throws(() => parseManualInput({ action: 'key', key: 'CTRL_ALT_DELETE' }), RemoteLiteProtocolError);
  assert.throws(() => parseWebRtcSignal({ type: 'offer', sdp: 'fake' }), RemoteLiteProtocolError);
  assert.deepEqual(parseWebRtcSignal({ type: 'candidate', candidate: 'candidate:...', sdpMid: '0', sdpMLineIndex: 0 }).type, 'candidate');
  assert.throws(() => parseWebRtcSignal({ type: 'candidate', candidate: 'candidate:...', sdpMid: '0', sdpMLineIndex: 0, cmd: 'shell' }), RemoteLiteProtocolError);
});

test('bounded sessions and input rate, with no input on limit breach', () => {
  let now = 1000;
  const store = new ManualRemoteSessionStore({ now: () => now, maxSessions: 1, maxInputsPerSecond: 2,
    authenticateViewer: ({ viewerId, deviceId }) => viewerId === 'friend' && deviceId.startsWith('d'),
    authenticateDevice: ({ deviceId, devicePrincipalId }) => devicePrincipalId === 'agent:' + deviceId });
  const s = store.request({ viewerId: 'friend', deviceId: 'd1' });
  assert.throws(() => store.request({ viewerId: 'friend', deviceId: 'd2' }), /SESSION_CAPACITY_REACHED/);
  store.accept({ sessionId: s.sessionId, deviceId: 'd1', devicePrincipalId: 'agent:d1' });
  const tap = (sequence) => store.input({ sessionId: s.sessionId, viewerId: 'friend', viewerToken: s.viewerToken, sequence, command: { action: 'tap', x: 0.2, y: 0.2 } });
  assert.doesNotThrow(() => tap(1));
  assert.doesNotThrow(() => tap(2));
  assert.throws(() => tap(3), /INPUT_RATE_LIMITED/);
  now += 1_000;
  assert.doesNotThrow(() => tap(3));
  store.close({ sessionId: s.sessionId, as: 'viewer', identityId: 'friend', viewerToken: s.viewerToken });
  assert.doesNotThrow(() => store.request({ viewerId: 'friend', deviceId: 'd2' }));
});

test('bounded signaling queues cannot grow indefinitely', () => {
  const { store, request, accept } = rig();
  const s = request(); accept(s.sessionId);
  for (let i = 0; i < 64; i++) store.signal({ sessionId: s.sessionId, from: 'viewer', identityId: 'friend-a', viewerToken: s.viewerToken,
    signal: { type: 'candidate', candidate: 'candidate:' + i, sdpMid: '0', sdpMLineIndex: 0 } });
  assert.throws(() => store.signal({ sessionId: s.sessionId, from: 'viewer', identityId: 'friend-a', viewerToken: s.viewerToken,
    signal: { type: 'candidate', candidate: 'candidate:overflow', sdpMid: '0', sdpMLineIndex: 0 } }), /SIGNAL_QUEUE_FULL/);
  assert.equal(store.receiveSignals({ sessionId: s.sessionId, as: 'device', identityId: 'signed-android-1' }).length, 64);
});

test('revoked device identity cannot receive more manual input or signaling', () => {
  let active = true;
  const store = new ManualRemoteSessionStore({
    authenticateViewer: ({viewerId, deviceId}) => viewerId === 'f' && deviceId === 'android',
    authenticateDevice: ({deviceId, devicePrincipalId}) => active && deviceId === 'android' && devicePrincipalId === 'signed-agent',
  });
  const s = store.request({viewerId:'f', deviceId:'android'});
  store.accept({sessionId:s.sessionId, deviceId:'android', devicePrincipalId:'signed-agent'});
  active = false;
  assert.throws(() => store.input({sessionId:s.sessionId,viewerId:'f',viewerToken:s.viewerToken,sequence:1,command:{action:'tap',x:0.5,y:0.5}}),/DEVICE_NOT_AUTHORIZED/);
  assert.throws(() => store.signal({sessionId:s.sessionId,from:'viewer',identityId:'f',viewerToken:s.viewerToken,signal:{type:'offer',sdp:'v=0\r\n'}}),/DEVICE_NOT_AUTHORIZED/);
  assert.equal(store.close({sessionId:s.sessionId,as:'viewer',identityId:'f',viewerToken:s.viewerToken}).status,'closed');
});
