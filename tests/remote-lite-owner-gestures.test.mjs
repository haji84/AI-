import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const portal = readFileSync(new globalThis.URL('../src/remote-lite/owner-portal-browser.mjs', import.meta.url), 'utf8');
const start = portal.indexOf('let gesture = null;');
const end = portal.indexOf("el('keys').querySelectorAll", start);
assert.ok(start >= 0 && end > start, 'the shipped portal must register its pointer gesture handlers');

function swipe(elapsed) {
  let now = 1000;
  const commands = [];
  const screen = { setPointerCapture() {} };
  runInNewContext(portal.slice(start, end), {
    el: () => screen, current: {}, performance: { now: () => now },
    point: e => ({ x: e.x, y: e.y }), send: command => commands.push(command),
  });
  screen.onpointerdown({ isPrimary: true, button: 0, pointerId: 1, x: .5, y: .75 });
  now += elapsed;
  screen.onpointerup({ pointerId: 1, x: .5, y: .3 });
  assert.equal(commands.length, 1);
  return commands[0];
}

test('portal swipes use durations accepted by the unchanged Android manual-input contract', () => {
  for (const [elapsed, expected] of [[50, 100], [99, 100], [100, 100], [250, 250], [1500, 1000]]) {
    const command = swipe(elapsed);
    assert.equal(command.action, 'swipe');
    assert.equal(command.durationMs, expected, `pointer gesture lasting ${elapsed}ms`);
    assert.equal(command.x1, .5); assert.equal(command.y1, .75);
    assert.equal(command.x2, .5); assert.equal(command.y2, .3);
  }
});
