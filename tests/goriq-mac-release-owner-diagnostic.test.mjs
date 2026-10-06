import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, lstat, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import * as native from '../scripts/goriq-mac-private-dashboard-native.mjs';

test('rejected dependency and mutable build cache expose only ownership class and write bits without changing files',async()=>{
  if(typeof process.getuid!=='function')return;
  const root=await mkdtemp(join(homedir(),'.goriq-release-owner-fixture-'));
  try {
    await chmod(root,0o700);
    for(const [key,mode,bucket,itemClass,groupWritable,worldWritable] of [
      ['node_modules/private-sensitive-name',0o660,'dependencies','file',true,false],
      ['.next/cache/private-sensitive-name',0o702,'build','directory',false,true],
    ]) {
      const release=join(root,bucket);await mkdir(release,{mode:0o700});
      const file=join(release,key);await mkdir(dirname(file),{recursive:true,mode:0o700});
      await writeFile(file,'PRIVATE_FILE_CONTENT',{mode:0o600});
      const target=itemClass==='directory'?dirname(file):file;await chmod(target,mode);
      const before=await lstat(target);
      let failure;try{await native.releaseInventory(release);}catch(error){failure=error;}
      assert.equal(failure?.message,'RELEASE_OWNER_REJECTED');
      const diagnostic=native.releaseOwnerDiagnostic?.(failure);
      assert.deepEqual(diagnostic,{surface:bucket,itemClass,ownerClass:'current-user',groupWritable,worldWritable});
      assert.doesNotMatch(JSON.stringify(diagnostic),/private-sensitive-name|PRIVATE_FILE_CONTENT|\/root|Users|uid|gid/);
      const after=await lstat(target);assert.equal(after.mode,before.mode);assert.equal(after.uid,before.uid);
      assert.equal(await readFile(file,'utf8'),'PRIVATE_FILE_CONTENT');
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test('untrusted error metadata and other failure classes cannot expose captured paths or output',()=>{
  assert.equal(typeof native.releaseOwnerDiagnostic,'function');
  const valid={surface:'source',itemClass:'directory',ownerClass:'other',groupWritable:false,worldWritable:false};
  for(const error of [
    Object.assign(Error('RELEASE_LINK_REJECTED'),{releaseBoundary:valid}),
    Object.assign(Error('RELEASE_OWNER_REJECTED'),{releaseBoundary:{...valid,surface:'/private/owner/path'}}),
    Object.assign(Error('RELEASE_OWNER_REJECTED'),{releaseBoundary:{...valid,stdout:'SECRET_VALUE'}}),
    Object.assign(Error('RELEASE_OWNER_REJECTED'),{releaseBoundary:{...valid,groupWritable:'PRIVATE_DNS'}}),
  ]) assert.equal(native.releaseOwnerDiagnostic(error),undefined);
  assert.deepEqual(native.releaseOwnerDiagnostic(Object.assign(Error('RELEASE_OWNER_REJECTED'),{
    releaseBoundary:valid,stdout:'SECRET_VALUE',stderr:'/private/owner/path'})),valid);
});
