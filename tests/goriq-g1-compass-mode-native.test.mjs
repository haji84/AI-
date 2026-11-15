import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

test('mode adapter exposes only a fixed native session and refuses non-Darwin activation',async()=>{
 const module=await import('../scripts/goriq-g1-compass-mode-native.mjs');
 assert.equal(typeof module.createCompassModeNative,'function');
 if(process.platform!=='darwin')await assert.rejects(module.createCompassModeNative({}),/NATIVE_CONTEXT_REJECTED/);
});

test('real POSIX descriptor fixtures verify mode-only effects, private journal durability, replay and drift refusal', {timeout:60000},t=>{
 const python=process.env.GORIQ_LOCAL_TDD_PYTHON??(process.platform==='win32'?null:'python3');
 if(!python)return t.skip('explicit fixture Python required on Windows');
 assert.ok(existsSync('scripts/goriq-g1-compass-mode-native.py'),'native core is required');
 const result=spawnSync(python,['-I','-B','tests/goriq-g1-compass-mode-native.test.py'],{
  encoding:'utf8',timeout:55000,maxBuffer:1048576,
  env:{...process.env,PYTHON_MANAGER_AUTOMATIC_INSTALL:'false',PYTHONDONTWRITEBYTECODE:'1'},
 });
 assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
});
