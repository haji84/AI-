import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

test('first-access guest inspector preserves the fixed public-only identity boundary', () => {
  const output = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-B', resolve('tests/ai09-first-access-inspect.test.py')],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(output.error, undefined);
  assert.equal(output.status, 0, output.stdout + output.stderr);
  assert.match(output.stderr, /Ran 13 tests/);
});
