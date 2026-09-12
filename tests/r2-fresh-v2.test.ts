import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkCases, suiteMeta } from '../benchmarks/internal/r2_v2/suite.mjs';
import { normalizeModelFinalOutput, extractBalancedJsonObject } from '../src/gai/model-output-normalizer.ts';

test('R2 v2 suite is fresh, frozen and split before heldout', () => {
  assert.equal(benchmarkCases.length, suiteMeta.expectedCaseCount);
  assert.equal(benchmarkCases.filter(c=>c.split==='train').length,60);
  assert.equal(benchmarkCases.filter(c=>c.split==='validation').length,30);
  assert.equal(benchmarkCases.filter(c=>c.split==='heldout').length,30);
  assert.equal(new Set(benchmarkCases.map(c=>c.promptSha256)).size,120);
});

test('normalizer removes only bounded presentation wrappers', () => {
  assert.equal(normalizeModelFinalOutput('<think>private scratch</think>\nFinal answer: VALID'),'VALID');
  assert.equal(normalizeModelFinalOutput('```json\n{"x":1}\n```'),'{"x":1}');
  assert.equal(normalizeModelFinalOutput('WRONG\nVALID'),'WRONG\nVALID');
});

test('JSON extraction returns first balanced object without repairing semantics', () => {
  assert.equal(extractBalancedJsonObject('Answer: {"a":{"b":2}} trailing'),'{"a":{"b":2}}');
  assert.equal(extractBalancedJsonObject('not-json'),'not-json');
});
