import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { runOwnedFixtureLanes } from './helpers/windows-ci-fixture-lanes.mjs';
const root=mkdtempSync(join(tmpdir(),'ci-owned-lanes-'));
after(()=>rmSync(root,{recursive:true,force:true}));
const child=(name,code)=>({name,command:process.execPath,args:['-e',code]});
const options={cwd:root,timeoutMs:10000,stdio:'ignore',log:()=>{}};

test('both owned fixture lanes run concurrently and retain independent completion',async()=>{
 const program=(name,other)=>`const fs=require('node:fs');fs.writeFileSync('${name}.ready','');let n=0;const t=setInterval(()=>{if(fs.existsSync('${other}.ready')){clearInterval(t);fs.writeFileSync('${name}.done','');}else if(++n>100){process.exit(32);}},20);`;
 await runOwnedFixtureLanes([child('atomic',program('atomic','media')),child('media',program('media','atomic'))],options);
 assert.equal(existsSync(join(root,'atomic.done')),true);assert.equal(existsSync(join(root,'media.done')),true);
});

test('a failed fixture lane is reported after the other owned lane finishes',async()=>{
 const marker=join(root,'after-peer-failure');
 await assert.rejects(runOwnedFixtureLanes([child('atomic','process.exit(13)'),child('media',`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'complete'),150)`)],options),/CI_FIXTURE_LANE_FAILED/);
 assert.equal(readFileSync(marker,'utf8'),'complete');
});

test('fixture deadline stops the owned child tree and reports failure',async()=>{
 const heartbeat=join(root,'heartbeat');
 const grandchild=`setInterval(()=>require('node:fs').appendFileSync(${JSON.stringify(heartbeat)},'x'),20)`;
 const parent=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
 await assert.rejects(runOwnedFixtureLanes([child('atomic',parent),child('media','setInterval(()=>{},1000)')],{...options,timeoutMs:2500}),/CI_FIXTURE_LANE_TIMEOUT/);
 const before=readFileSync(heartbeat,'utf8');await delay(100);assert.equal(readFileSync(heartbeat,'utf8'),before);
});
