import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

function verifyWithBusyHistory(overrides = {}) {
  const revision = 'a'.repeat(40);
  const run = { name: 'CI', event: 'push', head_branch: 'main', head_sha: revision,
    status: 'completed', conclusion: 'success', ...overrides };
  const harness = `
    const revision = ${JSON.stringify(revision)};
    const accepted = ${JSON.stringify(run)};
    globalThis.fetch = async input => {
      const url = new URL(input);
      const body = url.pathname.endsWith('/git/ref/heads/main')
        ? { object: { sha: revision } }
        : { workflow_runs: url.searchParams.get('event') === 'push' ? [accepted]
          : Array.from({ length: 100 }, () => ({ name: 'Scheduled diagnostics', event: 'schedule' })) };
      return { ok: true, json: async () => body };
    };
    await import('./scripts/goriq-pc-approved-source.mjs');
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', harness], {
    encoding: 'utf8', env: { ...process.env, GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: revision, GITHUB_REPOSITORY: 'haji84/AI-', GORIQ_PC_APPROVED_REVISION: revision },
  });
}

test('exact successful main push CI remains discoverable behind 100 unrelated runs', () => {
  const result = verifyWithBusyHistory();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).exactMainCi, true);
});

test('busy history never permits wrong-source, non-push, pending or failed CI', () => {
  for (const overrides of [ { name: 'Other workflow' }, { event: 'workflow_dispatch' },
    { head_branch: 'other' }, { head_sha: 'b'.repeat(40) }, { status: 'in_progress' },
    { conclusion: 'failure' } ]) {
    const result = verifyWithBusyHistory(overrides);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PC successful exact main CI required/);
  }
});

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
