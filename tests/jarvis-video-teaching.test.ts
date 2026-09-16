import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoSampleTimes, frameDifference, videoInstructions, type VideoTeachingMarker } from '../src/jarvis/video-teaching.ts';
import { TeachingStore } from '../src/jarvis/teaching.ts';

const marker = (seconds=0): VideoTeachingMarker => ({ id:'a', seconds, instruction:'詳細を開く', confirmed:true });
test('sampling supports five minutes and three hours with bounded work',()=>{
 for(const duration of [0.02,300,10800]){
  const times=videoSampleTimes(duration);assert(times.length<=120);assert(times.every(time=>time>=0&&time<duration));
 }
 for(const invalid of [0,-1,Infinity,NaN,10801])assert.throws(()=>videoSampleTimes(invalid));
});
test('screen-change score distinguishes stable pixels and ignores alpha only changes',()=>{
 const black=new Uint8ClampedArray([0,0,0,255]);
 assert.equal(frameDifference(black,black),0);
 assert.equal(frameDifference(black,new Uint8ClampedArray([255,255,255,255])),1);
 assert.equal(frameDifference(black,new Uint8ClampedArray([0,0,0,0])),0);
 assert.throws(()=>frameDifference(black,new Uint8ClampedArray()));
});
test('video draft requires reviewed nonempty single-line steps and rejects invalid times/secrets',()=>{
 for(const patch of [{confirmed:false},{instruction:''},{instruction:'a\nb'},{instruction:'password=secret'},{seconds:NaN},{seconds:-1},{seconds:10801}])assert.throws(()=>videoInstructions([{...marker(),...patch}]));
 assert.throws(()=>videoInstructions(Array.from({length:51},()=>marker())));
 assert.throws(()=>videoInstructions([]));
 const source=[marker(70),marker(2)];const result=videoInstructions(source);
 assert(result.startsWith('[動画 00:00:02]'));assert(result.includes('[動画 00:01:10]'));assert.equal(source[0].seconds,70);
});
test('video annotations persist as gated drafts and cannot become runnable evidence',()=>{
 const root=mkdtempSync(join(tmpdir(),'video-teaching-'));
 try{
  const store=new TeachingStore(join(root,'teaching.json'));
  const profile={deviceId:'test',platform:'android' as const,model:'test',osVersion:'1',app:'test.app',appVersion:'1'};
  const variant=store.manual({goal:'neutral demo',scope:'device',profile,instructions:videoInstructions([marker()]),completion:'詳細画面'});
  assert.equal(variant.status,'DRAFT');assert.equal(variant.steps[0].action.kind,'manual');assert(variant.steps[0].gate);assert.equal(variant.verifiedRunId,undefined);
  assert.throws(()=>store.beginRun(variant,profile,'execute'));
  assert.equal(new TeachingStore(join(root,'teaching.json')).get(variant.id).steps.length,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
