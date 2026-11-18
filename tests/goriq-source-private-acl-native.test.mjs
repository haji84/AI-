import process from 'node:process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
const shell=process.platform==='win32'?'powershell.exe':'pwsh';
test('Source ancestor integrity keeps write and private target boundaries', { timeout: 20000 },()=>{
  const r=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/goriq-owner-probe/test-source-ancestor-integrity.ps1'],{encoding:'utf8',timeout:17000,windowsHide:true});
  assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(r.stderr,'');assert.match(r.stdout,/SOURCE_ANCESTOR_INTEGRITY_PASS=91/);
});
test('Source ACL transaction journals and compares before apply and conditional rollback', { timeout: 25000 },()=>{
  const args=['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/goriq-owner-probe/test-source-private-acl-repair.ps1'];
  if(process.platform!=='win32')args.push('-CompileOnly');
  const r=spawnSync(shell,args,{encoding:'utf8',timeout:22000,windowsHide:true});
  assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(r.stderr,'');assert.match(r.stdout,/SOURCE_PRIVATE_REPAIR_PORTABLE_PASS=\d+/);
  assert.match(r.stdout,process.platform==='win32'?/SOURCE_PRIVATE_REPAIR_WINDOWS_PASS=1/:/SOURCE_PRIVATE_REPAIR_COMPILE_PASS=1/);
});
