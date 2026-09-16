import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { streamAndroidVideo } from "../src/jarvis/android-video.ts";
test("video rejects absent or modified runtime before ADB and releases failed admission",async()=>{
 const prior=process.env.JARVIS_SCRCPY_SERVER_PATH;const dir=mkdtempSync(join(tmpdir(),'jarvis-video-'));const response=new EventEmitter() as ServerResponse;
 try {
  delete process.env.JARVIS_SCRCPY_SERVER_PATH;
  await assert.rejects(streamAndroidVideo('must-not-run','one',response),/unavailable/);
  const file=join(dir,'wrong.jar');writeFileSync(file,'untrusted');process.env.JARVIS_SCRCPY_SERVER_PATH=file;
  for(let i=0;i<2;i++)await assert.rejects(streamAndroidVideo('must-not-run','one',response),/digest mismatch/);
  assert.equal(response.listenerCount('close'),0);
 } finally {if(prior===undefined)delete process.env.JARVIS_SCRCPY_SERVER_PATH;else process.env.JARVIS_SCRCPY_SERVER_PATH=prior;rmSync(dir,{recursive:true,force:true});}
});
