import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

test('enrollment source verifier fails before network for non-main dispatch or substituted revision', () => {
  for (const env of [{ GITHUB_REF: 'refs/heads/attacker', GITHUB_SHA: 'a'.repeat(40) }, { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'b'.repeat(40) }]) {
    const result = spawnSync(process.execPath, ['scripts/goriq-pc-approved-source.mjs'], { encoding: 'utf8', env: { ...process.env, ...env, GITHUB_REPOSITORY: 'haji84/AI-', GORIQ_PC_APPROVED_REVISION: 'a'.repeat(40) } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PC exact source context required/);
  }
});
test('untrusted revision cannot select the verifier executed before self-hosted checkout', () => {
  const workflow = readFileSync('.github/workflows/goriq-pc-enrollment.yml', 'utf8');
  const source = workflow.split('  source:')[1].split('  preflight:')[0];
  assert.match(source, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(source, /ref: \$\{\{ github.sha \}\}/);
  assert.doesNotMatch(source, /ref: \$\{\{ inputs.revision \}\}/);
  assert.match(workflow.split('  preflight:')[1], /needs: source/);
});
