import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planPinnedGitCoverage } from '../scripts/goriq-ai09-pinned-coverage.mjs';

function fixture(t) {
  const cwd=mkdtempSync(join(tmpdir(),'ai09-pinned-git-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const g=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',
    windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
  g('init','-q');
  g('config','user.name','AI09 Test');
  g('config','user.email','ai09@example.invalid');
  writeFileSync(join(cwd,'keep.txt'),'before');
  writeFileSync(join(cwd,'rename.txt'),'identical rename contents');
  g('add','-A');g('commit','-qm','base');
  const baseSha=g('rev-parse','HEAD');
  mkdirSync(join(cwd,'changes'));
  for(let i=0;i<203;i++)writeFileSync(join(cwd,'changes','f'+i+'.txt'),'review proof '+i+' 🌱\n');
  renameSync(join(cwd,'rename.txt'),join(cwd,'moved.txt'));
  writeFileSync(join(cwd,'keep.txt'),'after');
  g('add','-A');g('commit','-qm','head');
  return {cwd,baseSha,headSha:g('rev-parse','HEAD'),
    expectedPaths:['keep.txt','moved.txt',...Array.from({length:203},(_,i)=>'changes/f'+i+'.txt')]};
}
test('pinned Git objects provide complete SHA-bound coverage beyond legacy 30-file review cap',t=>{
  const f=fixture(t);
  const plan=planPinnedGitCoverage(f);
  assert.equal(plan.manifest.fileCount,205);
  assert.equal(new Set(plan.manifest.files.map(x=>x.path)).size,205);
  assert.equal(plan.manifest.files.find(x=>x.path==='moved.txt').status,'renamed');
  assert.equal(plan.manifest.files.find(x=>x.path==='keep.txt').status,'modified');
  assert.equal(plan.manifest.files.reduce((n,f)=>n+f.slices.length,0),
    plan.manifest.shards.reduce((n,s)=>n+s.sliceIds.length,0));
  assert.ok(plan.manifest.shards.every(s=>s.sliceIds.length<=24 && s.fileCount<=30));
});
test('missing authoritative path, invalid commit and binary file fail closed',t=>{
  const f=fixture(t);
  assert.throws(()=>planPinnedGitCoverage({...f,expectedPaths:f.expectedPaths.slice(1)}));
  assert.throws(()=>planPinnedGitCoverage({...f,headSha:f.baseSha}));
  writeFileSync(join(f.cwd,'binary.dat'),Buffer.from([0,1,2]));
  const g=(...args)=>execFileSync('git',args,{cwd:f.cwd,windowsHide:true,stdio:'ignore'});
  g('add','binary.dat');g('commit','-qm','binary');
  const headSha=execFileSync('git',['rev-parse','HEAD'],{cwd:f.cwd,encoding:'utf8'}).trim();
  assert.throws(()=>planPinnedGitCoverage({ ...f,headSha,expectedPaths:[...f.expectedPaths,'binary.dat'] }),
    /AI09_BINARY_REQUIRES_INDEPENDENT_REVIEW/);
});
