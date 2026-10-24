import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWindowsRemoteHost } from '../apps/remote-lite-windows/cmd/localhost/windows-host.mjs';

test('standalone EXE embeds exact manual-only peer and protocol source', () => {
  for (const name of ['browser-webrtc.mjs', 'manual-protocol.mjs', 'device-signature-format.mjs']) {
    assert.deepEqual(readFileSync(`apps/remote-lite-windows/cmd/localhost/${name}`),
      readFileSync(`src/remote-lite/${name}`));
  }
});

test('Windows signed relay applies manual input and stops at monotonic expiry despite wall clock rollback', async t => {
  let wall=Math.floor(Date.now()/1000)*1000, elapsed=10000;
  t.mock.method(Date,'now',()=>wall);
  const serverTime=wall+1000, expiry=serverTime+600000;
  const relayServers=[{urls:['turn:relay.example.net:3478?transport=udp'],username:(expiry/1000)+':'+ 'a'.repeat(32),credential:globalThis.btoa('a'.repeat(20))}];
  const offers = [{type:'offer', sdp:'v=0\r\na=sendrecv'}];
  const sent = [], inputs = [], states = [], messages = [];
  const track = {kind:'video',readyState:'live',addEventListener(){},stop(){this.readyState='ended';}};
  const stream = {getVideoTracks:()=>[track], getTracks:()=>[track]};
  let captureCalls = 0, channel;
  class FakeRTC {
    connectionState = 'connected';
    async createOffer() {return {type:'offer',sdp:'v=0\r\n'};}
    addTrack(receivedTrack, receivedStream) {
      assert.equal(receivedTrack, track);
      assert.equal(receivedStream, stream);
    }
    async setRemoteDescription(description) {
      assert.equal(description.type, 'offer');
      channel = {label:'goriq-manual-v1',readyState:'open',send:data=>messages.push(JSON.parse(data)),close(){this.readyState='closed';}};
      this.ondatachannel({channel});
    }
    async createAnswer() {return {type:'answer',sdp:'v=0\r\na=recvonly'};}
    async setLocalDescription(description) {this.localDescription=description;}
    async addIceCandidate() {}
    close() {this.connectionState='closed';}
  }
  const host = createWindowsRemoteHost({
    screen:{naturalWidth:1280,naturalHeight:720},
    canvas:{width:1280,height:720,captureStream:()=>{captureCalls++;return stream;}},
    rtcFactory:config=>{assert.deepEqual(config.iceServers,relayServers);return new FakeRTC();}, onStatus:state=>states.push(state),
    elapsedNow:()=>elapsed,
    schedule:()=>1, cancel:()=>{},
    request:async (path,body) => {
      if(path==='/api/remote/ice') {elapsed=10200;return {ok:true,json:async()=>({sessionId:'session-1',deviceId:'windows-1',mode:'turn-ephemeral-approved-provider',expiresAt:expiry,serverTime,iceServers:relayServers})};}
      if (path === '/api/remote/status') return {ok:true,status:200};
      if (path === '/api/remote/poll?ack=0') return {ok:true,json:async()=>({cursor:1,signals:offers.splice(0,1)})};
      if (path === '/api/remote/signal') {sent.push(body);return {ok:true,status:204};}
      if (path === '/api/remote/input') {inputs.push(body);return {ok:true,status:204};}
      throw new Error(`unexpected Windows route: ${path}`);
    },
  });
  await host.start();
  for (let i=0;i<10 && sent.length===0;i++) await new Promise(resolve=>globalThis.setTimeout(resolve,0));
  assert.equal(captureCalls,1);
  assert.deepEqual(sent,[{type:'answer',sdp:'v=0\r\na=recvonly'}]);
  channel.onmessage({data:JSON.stringify({sequence:1,command:{action:'pointer',phase:'move',button:'left',x:.5,y:.5}})});
  for (let i=0;i<10 && messages.length===0;i++) await new Promise(resolve=>globalThis.setTimeout(resolve,0));
  assert.deepEqual(inputs,[{action:'pointer',phase:'move',button:'left',x:.5,y:.5}]);
  assert.deepEqual(messages,[{type:'manual-applied',sequence:1}]);
  wall-=3600000; elapsed=610000;
  channel.onmessage({data:JSON.stringify({sequence:2,command:{action:'pointer',phase:'move',button:'left',x:.5,y:.5}})});
  for (let i=0;i<10 && track.readyState!=='ended';i++) await new Promise(resolve=>globalThis.setTimeout(resolve,0));
  assert.equal(inputs.length,1);
  assert.equal(messages.length,1);
  assert.equal(track.readyState,'ended');
  host.stop();
  assert.equal(track.readyState,'ended');
  assert.equal(channel.readyState,'closed');
  assert.equal(host.active,false);
  assert.ok(states.includes('local-stop'));
});

test('Windows stop cancels delayed ICE startup and refuses simultaneous starts before capture',async()=>{
  let finish,created=0,captured=0;
  const held=new Promise(resolve=>{finish=resolve;});
  const host=createWindowsRemoteHost({screen:{naturalWidth:10,naturalHeight:10},
    canvas:{width:10,height:10,captureStream:()=>{captured++;throw Error('unexpected capture');}},
    rtcFactory:()=>{created++;throw Error('unexpected RTC creation');},onStatus:()=>{},
    request:async path=>{assert.equal(path,'/api/remote/ice');return held;}});
  const started=host.start();
  const stopped=assert.rejects(started,/startup cancelled/);
  await assert.rejects(host.start(),/already started/);
  host.stop();
  finish({ok:true,json:async()=>({sessionId:'session-1',deviceId:'windows-1',mode:'direct-only',expiresAt:Date.now()+60000,serverTime:Date.now(),iceServers:[]})});
  await stopped;
  assert.equal(created,0);assert.equal(captured,0);assert.equal(host.active,false);
});

test('Windows rejects malformed or expired relay configuration without creating RTC or capture',async()=>{
  const direct={sessionId:'session-1',deviceId:'windows-1',mode:'direct-only',expiresAt:Date.now()+60000,serverTime:Date.now(),iceServers:[]};
  for(const ice of [{...direct,mode:'unknown'},{...direct,expiresAt:Date.now()-1},
    {...direct,mode:'turn-ephemeral-approved-provider'}, {...direct,iceServers:[{}]},
    {...direct,privateSecret:'must-not-pass'}, {...direct,serverTime:undefined},
    {...direct,serverTime:Date.now()-30001}]){
    let created=0,captured=0;
    const host=createWindowsRemoteHost({screen:{naturalWidth:10,naturalHeight:10},
      canvas:{width:10,height:10,captureStream:()=>{captured++;}},
      rtcFactory:()=>{created++;throw Error('unexpected RTC creation');},onStatus:()=>{},
      request:async path=>{assert.equal(path,'/api/remote/ice');return {ok:true,json:async()=>ice};}});
    await assert.rejects(host.start(),/configuration invalid/);
    assert.equal(created,0);assert.equal(captured,0);assert.equal(host.active,false);
  }
});

test('Windows STUN follows fresh signed status after initial ICE expiry and stops on revocation', async t => {
  const iceServers = [{ urls: ['stun:stun.cloudflare.com:3478'], username: '', credential: '' }];
  const now = Date.now();
  const ice = { sessionId: 'session-1', deviceId: 'windows-1', mode: 'stun-approved-provider',
    serverTime: now, expiresAt: now + 60000, iceServers };
  let elapsed = 0, statusActive = true, statusChecks = 0, watchdog;
  t.mock.method(globalThis, 'setInterval', callback => { watchdog = callback; return 88; });
  let options, captured = 0;
  const track = { kind: 'video', readyState: 'live', addEventListener() {}, stop() { this.readyState = 'ended'; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const host = createWindowsRemoteHost({ screen: { naturalWidth: 10, naturalHeight: 10 },
    canvas: { width: 10, height: 10, captureStream: () => { captured++; return stream; } },
    rtcFactory: value => { options = value; return { createOffer() {}, close() {}, addTrack() {} }; },
    onStatus() {}, schedule: () => 1, cancel() {}, elapsedNow: () => elapsed,
    request: async path => path === '/api/remote/ice' ? { ok: true, json: async () => ice }
      : path === '/api/remote/status' ? { ok: (++statusChecks, statusActive) } : { ok: true, json: async () => ({ cursor: 0, signals: [] }) },
  });
  try {
    await host.start();
    assert.deepEqual(options.iceServers, iceServers);
    assert.notEqual(options.iceTransportPolicy, 'relay');
    assert.equal(captured, 1);
    elapsed = 61000;
    watchdog();
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.equal(statusChecks, 2);
    assert.equal(track.readyState, 'live');
    assert.equal(host.active, true);
    statusActive = false;
    watchdog();
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.equal(track.readyState, 'ended');
    assert.equal(host.active, false);
  } finally { host.stop(); }
  assert.equal(track.readyState, 'ended');
  for (const server of [{ ...iceServers[0], credential: 'unexpected' },
    { ...iceServers[0], urls: ['stun:localhost:3478'] }, { ...iceServers[0], urls: ['stun:stun.cloudflare.com:53'] }]) {
    const invalidHost = createWindowsRemoteHost({ screen: { naturalWidth: 10, naturalHeight: 10 },
      canvas: { width: 10, height: 10, captureStream() { throw Error('unexpected capture'); } },
      rtcFactory() { throw Error('unexpected RTC'); }, onStatus() {},
      request: async () => ({ ok: true, json: async () => ({ ...ice, iceServers: [server] }) }),
    });
    await assert.rejects(invalidHost.start(), /configuration invalid/);
  }
});
