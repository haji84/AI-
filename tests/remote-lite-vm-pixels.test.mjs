import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFunction } from 'node:vm';
import { compareFrameHistory, compareFramePixels, pixelProbeScript } from '../scripts/remote-lite-vm-pixels.mjs';

const blank = () => Array(12 * 7 * 4).fill(0);
const color = (pixels, index, rgb) => {
  pixels.splice(index * 4, 4, ...rgb, 255);
  return pixels;
};

test('a sparse bright GDI pixel cannot make a black viewer pass', () => {
  const image = color(blank(), 0, [255, 255, 255]);
  const result = compareFramePixels(image, image, blank());
  assert.equal(result.sourceHasContent, true);
  assert.equal(result.matched, false);
  assert.equal(result.viewerErrorRatio, 1);
});

test('matching decoded pixels pass while invalid or empty frames fail', () => {
  const image = color(blank(), 4, [80, 120, 160]);
  color(image, 50, [160, 120, 80]);
  assert.equal(compareFramePixels(image, [...image], [...image]).matched, true);
  assert.equal(compareFramePixels(image, image, []).matched, false);
  assert.equal(compareFramePixels(blank(), blank(), blank()).matched, false);
});

test('a not-yet-drawable frame allows another VM probe attempt', () => {
  const probe = compileFunction(pixelProbeScript('#remoteVideo'), ['document']);
  const document = {
    querySelector: () => ({ videoWidth: 1920, readyState: 2 }),
    createElement: () => ({ getContext: () => ({ drawImage: () => { throw new Error('not ready'); } }) }),
  };
  assert.equal(probe(document), null);
});

test('source image and stream canvas can be sampled in one browser evaluation', () => {
  const probe = compileFunction(pixelProbeScript('#screen', '#sourceCanvas'), ['document']);
  const document = {
    querySelector: selector => ({ tagName:'CANVAS', width:12, height:7, selector }),
    createElement: () => ({ getContext: () => ({
      drawImage: element => { document.lastElement = element.selector; },
      getImageData: () => ({ data: [document.lastElement === '#screen' ? 10 : 20] }),
    }) }),
  };
  assert.deepEqual(probe(document), [[10], [20]]);
});

test('a decoded earlier frame matches its own GDI/Canvas generation', () => {
  const earlier = color(blank(), 0, [100, 120, 140]);
  const current = color(blank(), 0, [220, 240, 250]);
  const frames = [{ image:earlier, canvas:earlier }, { image:current, canvas:current }];
  assert.equal(compareFrameHistory(frames, [...earlier]).matched, true);
  assert.equal(compareFrameHistory(frames, blank()).matched, false);
  assert.equal(compareFrameHistory([{ image:earlier, canvas:blank() }], earlier).matched, false);
});
