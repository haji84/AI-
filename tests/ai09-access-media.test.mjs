import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { readFileSync } from 'node:fs';

test('approved native payload bytes remain LF across Git checkouts', () => {
  const attributes = readFileSync('.gitattributes','utf8');
  for (const path of ['scripts/ai09-access-media.ps1','scripts/ai09-owner-key-enroll.py']) {
    assert.ok(attributes.split(/\r?\n/).includes(`${path} text eol=lf`), `${path} must preserve approved byte hashes`);
  }
});

test('AI09 new access media guards execute without live VM or credential mutation', () => {
  const executable = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
  const env = { ...process.env }; delete env.PSModulePath;
  const result = spawnSync(executable, ['-NoLogo','-NoProfile','-NonInteractive','-File',resolve('tests/ai09-access-media.test.ps1')], {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:131072,env});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /AI09_ACCESS_MEDIA_FIXTURES_PASS/);
});
