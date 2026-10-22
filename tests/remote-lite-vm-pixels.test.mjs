import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFunction } from 'node:vm';
import * as pixels from '../scripts/remote-lite-vm-pixels.mjs';
const { compareFrameHistory, compareFramePixels, pixelProbeScript } = pixels;

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

test('draw probe records the image only after that image has reached the stream canvas', () => {
  assert.equal(typeof pixels.installFrameDrawProbe, 'function');
  const image = { pixels: 'first' };
  const canvas = { pixels: null };
  const context = { drawImage(source) { canvas.pixels = source.pixels; } };
  canvas.getContext = () => context;
  const samples = [];
  assert.equal(pixels.installFrameDrawProbe(image, canvas,
    () => samples.push([image.pixels, canvas.pixels])), true);
  assert.deepEqual(samples, []);
  context.drawImage(image);
  image.pixels = 'second';
  assert.deepEqual(samples, [['first', 'first']]);
  context.drawImage(image);
  assert.deepEqual(samples, [['first', 'first'], ['second', 'second']]);
  context.drawImage({ pixels: 'unrelated' });
  assert.equal(samples.length, 2);
});

test('native-size copy uses the same final sampling path for image and canvas', () => {
  assert.equal(typeof pixels.nativeCopyPixelProbeScript, 'function');
  const actual = Array(12 * 7 * 4).fill(100);
  const distorted = Array(12 * 7 * 4).fill(30);
  const image = { tagName: 'IMG', complete: true, naturalWidth: 24, naturalHeight: 14, pixels: actual };
  const canvas = { tagName: 'CANVAS', width: 24, height: 14, pixels: actual };
  const document = {
    querySelector: selector => selector === '#screen' ? image : canvas,
    createElement: () => {
      const target = { width: 0, height: 0, pixels: null };
      target.getContext = () => ({
        drawImage: source => { target.pixels = target.width === 12 && source.tagName === 'IMG' ? distorted : source.pixels; },
        getImageData: () => ({ data: target.pixels }),
      });
      return target;
    },
  };
  const direct = compileFunction(pixelProbeScript('#screen', '#sourceCanvas'), ['document'])(document);
  assert.notDeepEqual(direct[0], direct[1]);
  const normalized = compileFunction(pixels.nativeCopyPixelProbeScript('#screen', '#sourceCanvas'), ['document'])(document);
  assert.deepEqual(normalized, [actual, actual]);
});
