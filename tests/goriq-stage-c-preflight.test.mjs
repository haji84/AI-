import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';
import { selectNubia, summarizeNode, readExistingAdb } from '../scripts/goriq-stage-c-preflight.mjs';

test('preflight selects only one connected allowlisted physical Nubia', () => {
  const devices = [{serial:'owned',state:'device',model:'A403ZT',transport:'usb:1-1'}, {serial:'other',state:'device',model:'A403ZT',transport:'usb:1-2'}];
  assert.equal(selectNubia(devices, ['owned']).serial, 'owned');
  assert.throws(() => selectNubia(devices, []), /allowlist/);
  assert.throws(() => selectNubia(devices, ['other','owned']), /exactly one/);
  assert.throws(() => selectNubia([{...devices[0],state:'unauthorized'}], ['owned']), /exactly one/);
  assert.throws(() => selectNubia([{...devices[0],model:'generic Android'}], ['owned']), /exactly one/);
  assert.throws(() => selectNubia([{...devices[0],transport:'local:192.168.1.2:5555'}], ['owned']), /exactly one/);
  assert.throws(() => selectNubia([{...devices[0],transport:undefined}], ['owned']), /exactly one/);
});

test('existing-server protocol handles fragmented reads and denies device mutations', async () => {
  const server = createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data',chunk => {
      buffer = Buffer.concat([buffer,chunk]);
      if (buffer.length < 4) return;
      const length = Number.parseInt(buffer.subarray(0,4).toString(),16);
      if (buffer.length < length+4) return;
      assert.equal(buffer.subarray(4,4+length).toString(),'host:devices-l');
      socket.write('OK');
      setImmediate(() => { socket.write('AY0005'); socket.end('owned'); });
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    assert.equal(await readExistingAdb('host:devices-l',null,server.address().port),'owned');
    await assert.rejects(readExistingAdb('shell:reboot','owned'),/denied/);
    await assert.rejects(readExistingAdb('shell:getprop ro.product.model','owned;reboot'),/denied/);
    await assert.rejects(readExistingAdb('shell:getprop ro.product.model'),/target/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('preflight never substitutes stale, duplicate or simulated fleet evidence', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const node = {id:'n',kind:'android',label:'nubia A403ZT',lastSeenAt:now.toISOString(),telemetry:{workerVersion:'0.4.3'}};
  assert.equal(summarizeNode([node],now).registered,true);
  assert.equal(summarizeNode([node],now).contractValid,false);
  assert.equal(summarizeNode([node],now).physicalAcceptance,'BLOCKED');
  assert.equal(summarizeNode([{...node,lastSeenAt:'2026-09-30T00:00:00Z'}],now).fresh,false);
  assert.equal(summarizeNode([{...node,lastSeenAt:'2026-10-02T00:00:00Z'}],now).fresh,false);
  assert.equal(summarizeNode([node,{...node,id:'another'}],now).registered,false);
  const result = summarizeNode([{...node,token:'secret',telemetry:{credentials:'secret'}}],now);
  assert.equal(JSON.stringify(result).includes('secret'),false);
});
