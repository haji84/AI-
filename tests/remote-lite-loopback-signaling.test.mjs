import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { request as nodeRequest } from 'node:http';
import { ManualRemoteCoordinator } from '../src/remote-lite/manual-coordinator.mjs';
import { RemoteLitePairingRegistry } from '../src/remote-lite/device-pairing.mjs';
import { createLoopbackSignaling } from '../src/remote-lite/loopback-signaling.mjs';
import { createManualSignalingTransport } from '../src/remote-lite/manual-signaling-transport.mjs';

async function rig() {
  // Fixed synthetic identities are local-test fixtures, not production tokens.
  const sessions = new Map([['fixture-alice', 'alice'], ['fixture-bob', 'bob']]);
  const authorized = ({ ownerId, authorization }) => sessions.get(authorization) === ownerId;
  const coordinator = new ManualRemoteCoordinator({ authorizeOwner: authorized });
  const local = createLoopbackSignaling({
    coordinator,
    authenticateOwnerRequest: async req => {
      const value = req.headers.authorization;
      if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
      const authorization = value.slice(7);
      const ownerId = sessions.get(authorization);
      return ownerId ? { ownerId, authorization } : null;
    },
  });
  const info = await local.start();
  const url = 'http://' + info.hostname + ':' + info.port;
  const post = async (route, data = {}, token = 'fixture-alice', options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await globalThis.fetch(url + route, {
      method: options.method || 'POST', headers,
      body: options.body === undefined ? JSON.stringify(data) : options.body,
      redirect: 'manual',
    });
    const result = await response.json();
    return { status: response.status, ...result, headers: response.headers };
  };
  const key = (keys, payload) => sign(null, Buffer.from(payload), keys.privateKey).toString('base64');
  const deviceProof = async (device, sessionId, operation, payloadHash = '') => {
    const ch = await post('/v1/device/challenge', { deviceId: device.deviceId, sessionId, operation, payloadHash }, null);
    assert.equal(ch.status, 200);
    const message = RemoteLitePairingRegistry.deviceMessage({
      ...ch.result, deviceId: device.deviceId, sessionId, operation, payloadHash,
    });
    return { ...ch.result, deviceId: device.deviceId, sessionId, operation, payloadHash, signature: key(device.keys, message) };
  };
  const discoveryProof = (device) => {
    const issuedAt = Date.now(), nonce = randomBytes(24).toString('hex');
    return { deviceId: device.deviceId, issuedAt, nonce,
      signature: key(device.keys, RemoteLitePairingRegistry.discoveryMessage({deviceId:device.deviceId,issuedAt,nonce})) };
  };
  const register = async (ownerToken, deviceId) => {
    const keys = generateKeyPairSync('ed25519');
    const invitation = await post('/v1/invite', {}, ownerToken);
    assert.equal(invitation.status, 200);
    const proposed = await post('/v1/device/propose', {
      inviteCode: invitation.result.inviteCode, deviceId,
      publicKeyPem: keys.publicKey.export({type:'spki',format:'pem'}),
    }, null);
    assert.equal(proposed.status, 200);
    const message = RemoteLitePairingRegistry.enrollmentMessage({
      ...proposed.result, deviceId,
    });
    assert.equal((await post('/v1/device/prove', {
      requestId: proposed.result.requestId, signature: key(keys, message),
    }, null)).status, 200);
    const approved = await post('/v1/approve', {
      requestId: proposed.result.requestId,
      expectedFingerprint: proposed.result.fingerprint,
    }, ownerToken);
    assert.equal(approved.status, 200);
    return { deviceId, keys, fingerprint: approved.result.fingerprint };
  };
  return { local, info, post, url, register, deviceProof, discoveryProof, sessions };
}

test('real local HTTP: owner invites, device signs, owner approves, offer/answer, then disconnect', async t => {
  const h = await rig();
  t.after(() => h.local.stop());
  assert.deepEqual({ hostname:h.info.hostname, protocol:h.info.protocol, mode:h.info.mode }, {
    hostname:'127.0.0.1', protocol:'http', mode:'local-test-only',
  });
  const device = await h.register('fixture-alice', 'win-alice');
  const started = await h.post('/v1/start', { deviceId: device.deviceId });
  assert.equal(started.status, 200);
  assert.equal(started.result.status, 'pending');
  const sessionId = started.result.sessionId, viewerToken = started.result.viewerToken;
  assert.equal((await h.post('/v1/device/accept', {
    deviceId: device.deviceId, sessionId,
    proof: await h.deviceProof(device, sessionId, 'session-accept'),
  }, null)).result.status, 'active');

  const offer = {type:'offer',sdp:'v=0\r\n'};
  assert.equal((await h.post('/v1/viewer/signal', {sessionId,viewerToken,signal:offer})).status, 200);
  const polled = await h.post('/v1/device/poll', {
    sessionId, deviceId: device.deviceId, proof: await h.deviceProof(device, sessionId, 'signal-receive'),
  }, null);
  assert.deepEqual(polled.result, {cursor:1, signals:[offer]});

  const answer = {type:'answer',sdp:'v=0\r\na=recvonly'};
  const hash = createHash('sha256').update(JSON.stringify(answer)).digest('hex');
  assert.equal((await h.post('/v1/device/signal', {
    sessionId, deviceId:device.deviceId, signal:answer,
    proof: await h.deviceProof(device, sessionId, 'signal-send', hash),
  }, null)).status, 200);
  const reply = await h.post('/v1/viewer/poll', {sessionId,viewerToken});
  assert.deepEqual(reply.result, {cursor:1, signals:[answer]});
  assert.equal((await h.post('/v1/device/status', {
    sessionId, deviceId: device.deviceId,
    proof: await h.deviceProof(device, sessionId, 'session-status'),
  }, null)).result.status, 'active');
  assert.equal((await h.post('/v1/viewer/status',{sessionId,viewerToken})).result.status,'active');
  const lateStatusProof = await h.deviceProof(device, sessionId, 'session-status');
  assert.equal((await h.post('/v1/viewer/end',{sessionId,viewerToken})).result.status,'closed');
  assert.equal((await h.post('/v1/device/status', {
    sessionId, deviceId: device.deviceId,
    proof: lateStatusProof,
  }, null)).status, 403);
  assert.equal((await h.post('/v1/device/challenge', {
    sessionId, deviceId: device.deviceId, operation: 'session-status',
  }, null)).status, 403);
  assert.equal((await h.post('/v1/viewer/status',{sessionId,viewerToken})).status,403);
});

test('signed local status check shuts a WebRTC host before applying input after revocation', async t => {
  const { createDeviceSessionCheck, BrowserManualPeer } = await import('../src/remote-lite/browser-webrtc.mjs');
  assert.equal(typeof createDeviceSessionCheck, 'function');
  const h = await rig();
  t.after(() => h.local.stop());
  const device = await h.register('fixture-alice', 'win-alice-status');
  const started = await h.post('/v1/start', { deviceId: device.deviceId });
  assert.equal(started.status, 200);
  const { sessionId } = started.result;
  assert.equal((await h.post('/v1/device/accept', {
    sessionId, deviceId: device.deviceId,
    proof: await h.deviceProof(device, sessionId, 'session-accept'),
  }, null)).result.status, 'active');
  const checkSession = createDeviceSessionCheck({
    sessionId, deviceId: device.deviceId,
    post: (path, payload) => h.post(path, payload, null),
    signMessage: message => sign(null, Buffer.from(message), device.keys.privateKey).toString('base64'),
  });
  assert.equal(await checkSession(), true);
  let stopped = 0, applied = 0;
  const track = { kind: 'video', readyState: 'live', addEventListener() {}, stop() { stopped++; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const rtc = { connectionState: 'connected', createOffer() {}, addTrack() {}, close() {} };
  const host = new BrowserManualPeer({ role: 'host', rtcFactory: () => rtc,
    sendSignal: () => {}, checkSession, requestScreen: () => stream,
    onManualInput: () => { applied++; return true; } });
  t.after(() => host.close());
  await host.approveLocalScreen();
  const channel = { label: 'goriq-manual-v1', readyState: 'open', close() { this.readyState = 'closed'; }, send() {} };
  rtc.ondatachannel({ channel });
  assert.equal((await h.post('/v1/revoke', { deviceId: device.deviceId })).result.status, 'revoked');
  channel.onmessage({ data: JSON.stringify({ sequence: 1, command: { action: 'tap', x: 0.5, y: 0.5 } }) });
  const deadline = Date.now() + 4000;
  while (!host.closed && Date.now() < deadline) await new Promise(resolve => globalThis.setTimeout(resolve, 10));
  assert.equal(host.closed, true);
  assert.equal(applied, 0);
  assert.equal(stopped, 1);
});

test('real local HTTP: unauthorized users cannot enumerate or control other owners devices', async t => {
  const h = await rig();t.after(() => h.local.stop());
  const device = await h.register('fixture-alice','android-alice');
  assert.equal((await h.post('/v1/start',{deviceId:device.deviceId},null)).status,401);
  assert.equal((await h.post('/v1/start',{deviceId:device.deviceId},'fixture-bob')).status,403);
  assert.equal((await h.post('/v1/revoke',{deviceId:device.deviceId},'fixture-bob')).status,403);
  assert.equal((await h.post('/v1/invite',{ownerId:'alice'},'fixture-bob')).status,400);
  const own = await h.post('/v1/start',{deviceId:device.deviceId});
  assert.equal(own.status,200);
  assert.equal((await h.post('/v1/viewer/poll',{sessionId:own.result.sessionId,viewerToken:own.result.viewerToken},'fixture-bob')).status,403);
  h.sessions.delete('fixture-alice');
  assert.equal((await h.post('/v1/viewer/poll',{sessionId:own.result.sessionId,viewerToken:own.result.viewerToken})).status,401);
});

test('real local HTTP: rejects malicious Host, browser Origin and unexpected cookies', async t => {
  const h = await rig();t.after(() => h.local.stop());
  // Undici fetch rewrites the forbidden Host header; use an actual HTTP client
  // so that the on-wire Host header is genuinely hostile.
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = nodeRequest({
      host: h.info.hostname, port: h.info.port, path: '/v1/invite', method: 'POST',
      headers: { Host: 'attacker.example', 'Content-Type': 'application/json', Authorization: 'Bearer fixture-alice' },
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await h.post('/v1/invite',{},'fixture-alice',{headers:{Origin:'https://attacker.example'}})).status,403);
  assert.equal((await h.post('/v1/invite',{},'fixture-alice',{headers:{Cookie:'session=forged'}})).status,403);
  assert.equal((await h.post('/v1/invite',{},'fixture-alice',{method:'GET',body:null})).status,404);
  assert.equal((await h.post('/v1/not-a-route')).status,404);
});

test('real local HTTP: refuses oversized payload, unknown content and malformed JSON', async t => {
  const h = await rig();t.after(() => h.local.stop());
  assert.equal((await h.post('/v1/invite',{},'fixture-alice',{headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await h.post('/v1/invite',{},'fixture-alice',{body:'{' })).status,400);
  assert.equal((await h.post('/v1/device/propose',{},null,{body:JSON.stringify({large:'x'.repeat(100000)})})).status,413);
  const s = await h.post('/v1/invite',{},'fixture-alice');
  assert.equal(s.headers.get('cache-control'),'no-store');
  assert.equal(s.headers.get('x-content-type-options'),'nosniff');
});

test('real local HTTP: signed challenge rejection prevents forged session acceptance', async t => {
  const h = await rig();t.after(() => h.local.stop());
  const device = await h.register('fixture-alice','android-alice');
  const started = await h.post('/v1/start',{deviceId:device.deviceId});
  const sessionId = started.result.sessionId;
  const proof = await h.deviceProof(device,sessionId,'session-accept');
  proof.signature = 'invalid';
  assert.equal((await h.post('/v1/device/accept',{sessionId,deviceId:device.deviceId,proof},null)).status,403);
  assert.equal((await h.post('/v1/viewer/status',{sessionId,viewerToken:started.result.viewerToken})).result.status,'pending');
});

test('real local HTTP: revoked devices cannot negotiate; clean stop is idempotent', async t => {
  const h=await rig();t.after(()=>h.local.stop());
  const device=await h.register('fixture-alice','android-alice');
  assert.equal((await h.post('/v1/revoke',{deviceId:device.deviceId})).result.status,'revoked');
  assert.equal((await h.post('/v1/start',{deviceId:device.deviceId})).status,403);
  assert.equal((await h.post('/v1/device/challenge',{deviceId:device.deviceId,operation:'reconnect',sessionId:'x'},null)).status,403);
  await h.local.stop();
  await h.local.stop();
});

test('real local HTTP: signed device pending discovery is scoped and one-use', async t => {
  const h=await rig();t.after(()=>h.local.stop());
  const alice=await h.register('fixture-alice','win-alice-pending');
  const bob=await h.register('fixture-bob','win-bob-pending');
  const started=await h.post('/v1/start',{deviceId:alice.deviceId});
  assert.equal(started.status,200);
  for(let i=0;i<20;i++) assert.equal((await h.post('/v1/device/challenge',{
    deviceId:alice.deviceId,sessionId:alice.deviceId,operation:'session-discover',
  },null)).status,403);
  const proof=h.discoveryProof(alice);
  const pending=await h.post('/v1/device/pending',{deviceId:alice.deviceId,proof},null);
  assert.equal(pending.status,200);
  assert.deepEqual(pending.result,{sessionId:started.result.sessionId,deviceId:alice.deviceId,status:'pending',expiresAt:started.result.expiresAt});
  assert.equal((await h.post('/v1/device/pending',{deviceId:alice.deviceId,proof},null)).status,403);
  assert.equal((await h.post('/v1/device/pending',{
    deviceId:bob.deviceId,proof:h.discoveryProof(bob),
  },null)).result,null);
  assert.equal((await h.post('/v1/device/pending',{
    deviceId:bob.deviceId,proof:h.discoveryProof(alice),
  },null)).status,403);
  assert.equal((await h.post('/v1/device/challenge',{
    deviceId:alice.deviceId,sessionId:started.result.sessionId,operation:'session-accept',
  },null)).status,200);
  await h.post('/v1/viewer/end',{sessionId:started.result.sessionId,viewerToken:started.result.viewerToken});
  assert.equal((await h.post('/v1/device/pending',{
    deviceId:alice.deviceId,proof:h.discoveryProof(alice),
  },null)).result,null);
});

test('separate viewer and device signaling clients exchange WebRTC messages only while authorized', async t => {
  const h=await rig();t.after(()=>h.local.stop());
  const device=await h.register('fixture-alice','windows-rtc-host');
  const started=await h.post('/v1/start',{deviceId:device.deviceId});
  const sessionId=started.result.sessionId,viewerToken=started.result.viewerToken;
  assert.equal((await h.post('/v1/device/accept',{
    sessionId,deviceId:device.deviceId,
    proof:await h.deviceProof(device,sessionId,'session-accept'),
  },null)).result.status,'active');
  const viewer=createManualSignalingTransport({role:'viewer',sessionId,viewerToken,
    post:(path,body)=>h.post(path,body,'fixture-alice')});
  const host=createManualSignalingTransport({role:'host',sessionId,deviceId:device.deviceId,
    post:(path,body)=>h.post(path,body,null),
    signMessage:message=>sign(null,Buffer.from(message),device.keys.privateKey).toString('base64')});
  const offer={type:'offer',sdp:'v=0\r\n'};
  await viewer.send(offer);
  assert.deepEqual(await host.receive(),[offer]);
  host.acknowledge();
  const answer={type:'answer',sdp:'v=0\r\na=recvonly'};
  await host.send(answer);
  assert.deepEqual(await viewer.receive(),[answer]);
  viewer.acknowledge();
  const candidate={type:'candidate',candidate:'candidate:1 1 udp 1 127.0.0.1 1234 typ host',sdpMid:'0',sdpMLineIndex:0};
  await host.send(candidate);
  assert.deepEqual(await viewer.receive(),[candidate]);
  viewer.acknowledge();
  assert.deepEqual(await host.receive(),[]);
  await h.post('/v1/revoke',{deviceId:device.deviceId});
  await assert.rejects(()=>host.receive(),/SIGNALING_REFUSED/);
  await assert.rejects(()=>viewer.send(offer),/SIGNALING_REFUSED/);
});

test('a lost poll response replays a large SDP until the receiver acknowledges it', async t => {
  const h = await rig(); t.after(() => h.local.stop());
  const device = await h.register('fixture-alice', 'windows-large-sdp');
  const started = await h.post('/v1/start', {deviceId:device.deviceId});
  const sessionId = started.result.sessionId, viewerToken = started.result.viewerToken;
  assert.equal((await h.post('/v1/device/accept', {
    sessionId, deviceId:device.deviceId,
    proof:await h.deviceProof(device, sessionId, 'session-accept'),
  }, null)).status, 200);
  const offer = {type:'offer', sdp:'v=0\r\n' + 'a'.repeat(32 * 1024)};
  assert.equal((await h.post('/v1/viewer/signal', {sessionId, viewerToken, signal:offer})).status, 200);
  let loseResponse = true;
  const host = createManualSignalingTransport({role:'host', sessionId, deviceId:device.deviceId,
    signMessage:message=>sign(null,Buffer.from(message),device.keys.privateKey).toString('base64'),
    post:async (path, body) => {
      const result = await h.post(path, body, null);
      if (path === '/v1/device/poll' && loseResponse) { loseResponse = false; throw new Error('simulated lost response'); }
      return result;
    },
  });
  await assert.rejects(()=>host.receive(),/SIGNALING_REFUSED/);
  assert.deepEqual(await host.receive(), [offer]);
  assert.deepEqual(await host.receive(), [offer]);
  host.acknowledge();
  assert.deepEqual(await host.receive(), []);
  const invalid = await h.post('/v1/device/poll', {sessionId, deviceId:device.deviceId, ack:3,
    proof:await h.deviceProof(device, sessionId, 'signal-receive')}, null);
  assert.equal(invalid.status, 403);
});
