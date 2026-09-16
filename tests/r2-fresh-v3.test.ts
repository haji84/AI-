import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkCases as v2 } from '../benchmarks/internal/r2_v2/suite.mjs';
import { benchmarkCases as v3, suiteMeta } from '../benchmarks/internal/r2_v3/suite.mjs';

test('R2 v3 is fresh, frozen and split before heldout', () => {
  assert.equal(suiteMeta.suiteId, 'gai-r2-fresh-v3');
  assert.equal(v3.length, 120);
  assert.equal(v3.filter(c=>c.split==='train').length, 60);
  assert.equal(v3.filter(c=>c.split==='validation').length, 30);
  assert.equal(v3.filter(c=>c.split==='heldout').length, 30);
  const v2fp=new Set(v2.map(c=>c.promptSha256));
  assert.equal(v3.some(c=>v2fp.has(c.promptSha256)), false);
  assert.equal(new Set(v3.map(c=>c.promptSha256)).size, 120);
});
