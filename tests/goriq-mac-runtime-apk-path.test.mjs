import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';

test('canonical Mac runtime exposes signed APK default and preserves configured path', async () => {
  const root = await mkdtemp(join(tmpdir(),'stage-c-runtime-'));
  const entry = resolve('scripts/jarvis-mac-runtime-entry.sh');
  const envFile = join(root,'runtime.env');
  await writeFile(envFile,'JARVIS_OWNER_TOKEN=fixture-only\n');
  try {
    for (const configured of ['',join(root,'custom.apk')]) {
      const result = await promisify(execFile)('bash',['-c',
        'exec() { printf "APK_PATH=%s\\n" "$(printenv JARVIS_WORKER_APK_PATH || true)"; }; source "$1"',
        'test-runtime',entry],{env:{...process.env,JARVIS_REPO_ROOT:root,JARVIS_STATE_ROOT:root,
          JARVIS_ENV_FILE:envFile,GORIQ_STATE_ROOT:join(root,'state'),JARVIS_WORKER_APK_PATH:configured},timeout:5000});
      const observed = result.stdout.split('\n').find(line => line.startsWith('APK_PATH='));
      assert.equal(observed,`APK_PATH=${configured || join(root,'jarvis-worker.apk')}`);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});
