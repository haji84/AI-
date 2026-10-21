import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

test('fixed read-only guest collector rejects unsafe evidence without native activation', () => {
  const run = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    ['-B', resolve('tests/ai09-readonly-evidence-collect.test.py')],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stderr, /Ran 15 tests/);
});
