import assert from 'node:assert/strict';
import test from 'node:test';
import { hostname } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { linuxProcessDefunct, acquireCognitiveLease } from '../src/gai/cognitive-lease.ts';

const stat = (pid:number, state:string, name='(strange ) name)') => `${pid} ${name} ${state} 1 1 1 1 1 1 1 1 1 1 1 1 1`;
test('Linux proc parser recognizes only correctly identified terminated process states',()=>{
  for(const s of ['Z','X','x']) assert.equal(linuxProcessDefunct(83,stat(83,s)),true);
  for(const s of ['R','S','D','T','I','W']) assert.equal(linuxProcessDefunct(83,stat(83,s)),false);
  assert.equal(linuxProcessDefunct(84,stat(83,'Z')),false);
  assert.equal(linuxProcessDefunct(83,'83 malformed Z'),false);
  assert.equal(linuxProcessDefunct(83,'83 (x) Z'),false);
  assert.equal(linuxProcessDefunct(0,stat(0,'Z')),false);
});

test('a live same-host owner remains protected and is not unlinked', async()=>{
  const root=mkdtempSync(join(tmpdir(),'goriq-lock-test-')); const lock=join(root,'writer.lock');
  try {
    const own={version:1,host:hostname(),pid:process.pid,nonce:randomUUID()};
    writeFileSync(lock,JSON.stringify(own));
    await assert.rejects(acquireCognitiveLease(lock),{code:'EEXIST'});
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('foreign and invalid owner metadata stay fail-closed', async()=>{
  const root=mkdtempSync(join(tmpdir(),'goriq-foreign-lock-'));const lock=join(root,'writer.lock');
  try {
    for (const metadata of [
      {version:1,host:hostname()+'-other',pid:999999,nonce:randomUUID()},
      {version:1,host:hostname(),pid:999999,nonce:'not-a-nonce'},
    ]) {
      writeFileSync(lock,JSON.stringify(metadata));
      await assert.rejects(acquireCognitiveLease(lock),{code:'EEXIST'});
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
