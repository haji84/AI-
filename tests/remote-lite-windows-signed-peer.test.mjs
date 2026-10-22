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

test('Windows host applies signed offer, manual input and local stop through native routes', async () => {
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
    rtcFactory:()=>new FakeRTC(), onStatus:state=>states.push(state),
    schedule:()=>1, cancel:()=>{},
    request:async (path,body) => {
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
  host.stop();
  assert.equal(track.readyState,'ended');
  assert.equal(channel.readyState,'closed');
  assert.equal(host.active,false);
  assert.ok(states.includes('local-stop'));
});
