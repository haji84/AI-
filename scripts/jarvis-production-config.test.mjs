import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { validateProductionConfig } from './jarvis-production-config.mjs';
import { serviceSpecs } from './jarvis-managed-process.mjs';

function fixture() {
  const environment = Object.fromEntries(['JARVIS_OWNER_SECRET','JARVIS_OWNER_TOKEN','JARVIS_REMOTE_GATEWAY_TOKEN',
    'JARVIS_REMOTE_ALLOWED_SERIALS','JARVIS_ADB_PATH','JARVIS_SCRCPY_SERVER_PATH','JARVIS_DB_PATH','JARVIS_TEACHING_PATH',
    'JARVIS_REMOTE_ASSIST_AUDIT_PATH','JARVIS_REMOTE_ASSIST_RECORDING_DIR','JARVIS_PRIVATE_WORKER_CERT_PATH','JARVIS_PRIVATE_WORKER_KEY_PATH'].map(k=>[k,'x'.repeat(32)]));
  Object.assign(environment,{JARVIS_PRIVATE_WORKER_HOST:'192.168.0.169',JARVIS_PUBLIC_BROKER_URL:'https://192.168.0.169:8792',JARVIS_WORKER_INSTALL_URL:'https://example.invalid/worker.apk'});
  for (const key of Object.keys(environment)) if (key.endsWith('_PATH') || key.endsWith('_DIR')) environment[key]=path.join(process.cwd(),'fixture',key);
  return {version:1,releaseRoot:process.cwd(),commit:'a'.repeat(40),environment};
}
test('production pins local management and supervises only explicitly enabled Worker ingress',()=>{
  const env=validateProductionConfig(fixture(),process.cwd());
  assert.equal(env.JARVIS_BROKER_HOST,'127.0.0.1');
  assert.equal(env.JARVIS_REMOTE_GATEWAY_HOST,'127.0.0.1');
  assert.equal(env.JARVIS_ENROLLMENT_PORTAL_ENABLED,'0');
  assert.equal(serviceSpecs(process.cwd()).some(s=>s.name==='private-worker-ingress'),false);
  const spec=serviceSpecs(process.cwd(),process.execPath,'3000',{enablePrivateWorkerIngress:true}).find(s=>s.name==='private-worker-ingress');
  assert.match(spec.args[0],/jarvis-private-worker-ingress\.ts$/);
});
test('production config rejects injection, wrong release, public origin, missing and short credentials',()=>{
  for(const mutate of [c=>c.environment.NODE_OPTIONS='--require=evil',c=>c.releaseRoot+='other',c=>c.commit='main',
    c=>c.environment.JARVIS_OWNER_TOKEN='short',c=>delete c.environment.JARVIS_OWNER_SECRET,
    c=>c.environment.JARVIS_PRIVATE_WORKER_HOST='0.0.0.0',c=>c.environment.JARVIS_PUBLIC_BROKER_URL='http://192.168.0.169:8792',
    c=>c.environment.JARVIS_WORKER_INSTALL_URL='https://user:password@example.invalid',c=>c.environment.JARVIS_DB_PATH='a\nb']) {
    const c=fixture();mutate(c);assert.throws(()=>validateProductionConfig(c,process.cwd()));
  }
});
test('Windows DPAPI reader accepts the newline written by Set-Content', {skip:process.platform!=='win32'},()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-dpapi-test-'));
  const file=path.join(directory,'fixture.dpapi');
  const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  try {
    const encoded=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',"$env:PSModulePath=Join-Path $PSHOME 'Modules'; 'non-secret-fixture' | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString"],{encoding:'utf8',windowsHide:true});
    assert.equal(encoded.status,0,encoded.stderr);
    fs.writeFileSync(file,encoded.stdout.trim()+'\r\n');
    const decoded=spawnSync(powershell,['-NoProfile','-NonInteractive','-File',path.resolve('scripts/read-jarvis-production-config.ps1'),'-Path',file],{encoding:'utf8',windowsHide:true});
    assert.equal(decoded.status,0,decoded.stderr);
    assert.equal(decoded.stdout,'non-secret-fixture');
  } finally { if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(directory); }
});
