import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new globalThis.URL('../apps/remote-lite-windows/cmd/localhost/index.html', import.meta.url), 'utf8');
const start = html.indexOf('function pt(e){');
const end = html.indexOf("screen.addEventListener('pointerdown'", start);
assert.ok(start >= 0 && end > start, 'the shipped preview must define its pointer mapping');
const source = html.slice(start, end);

function mapPoint({ imageWidth, imageHeight, clientX, clientY }) {
  const screen = {
    naturalWidth: imageWidth,
    naturalHeight: imageHeight,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
  };
  return runInNewContext(`${source}\npt({clientX:${clientX},clientY:${clientY}})`, { screen });
}

test('Windows preview maps 4:3 image edges instead of the 16:9 element edges', () => {
  const left = mapPoint({ imageWidth: 720, imageHeight: 540, clientX: 120, clientY: 270 });
  const right = mapPoint({ imageWidth: 720, imageHeight: 540, clientX: 840, clientY: 270 });
  assert.equal(left.x, 0);
  assert.equal(right.x, 1);
  assert.equal(left.y, 0.5);
});

test('Windows preview refuses clicks in letterbox bars', () => {
  assert.equal(mapPoint({ imageWidth: 720, imageHeight: 540, clientX: 40, clientY: 270 }), null);
  assert.equal(mapPoint({ imageWidth: 720, imageHeight: 540, clientX: 920, clientY: 270 }), null);
});
