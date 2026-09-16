import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { rawRemotePreview, captureRemotePreview } from "../src/jarvis/remote-preview.ts";
import { containedScreenGeometry, screenPoint } from "../src/jarvis/remote-screen-input.ts";
function raw(width = 1080, height = 2400, header = 16) {
 const b = Buffer.alloc(width * height * 4 + header, 255);
 b.writeUInt32LE(width, 0); b.writeUInt32LE(height, 4); b.writeUInt32LE(1, 8);
 if (header === 16) b.writeUInt32LE(1, 12);
 return b;
}
test("compact raw preview preserves physical dimensions with bounded portrait and landscape images", async () => {
 for (const [w,h,header] of [[1080,2400,16],[2400,1080,12]]) {
  const p=await rawRemotePreview(raw(w,h,header));
  const m=await sharp(Buffer.from(p.imageBase64,"base64")).metadata();
  assert.equal(p.nativeWidth,w); assert.equal(p.nativeHeight,h);
  assert.equal(Math.max(m.width!,m.height!),1280); assert.equal(m.format,"jpeg");
 }
});
test("raw parser rejects truncated, extra, oversized, unsupported pixel and colour formats", async()=>{
 const wrongFormat=raw(2,2);wrongFormat.writeUInt32LE(4,8);
 const wrongColour=raw(2,2);wrongColour.writeUInt32LE(2,12);
 const huge=raw(2,2);huge.writeUInt32LE(20001,0);
 for(const b of [Buffer.alloc(8),raw(2,2).subarray(0,30),Buffer.concat([raw(2,2),Buffer.alloc(1)]),wrongFormat,wrongColour,huge]) await assert.rejects(rawRemotePreview(b));
});
test("unsupported raw capture falls back to PNG; failed fallback remains visible", async()=>{
 const png=await sharp({create:{width:4,height:8,channels:3,background:"red"}}).png().toBuffer();
 const calls:boolean[]=[];
 const p=await captureRemotePreview(async raw=>{calls.push(raw);return raw?Buffer.alloc(1):png;});
 assert.deepEqual(calls,[true,false]);assert.equal(p.previewSource,"png-fallback");assert.equal(p.nativeHeight,8);
 await assert.rejects(captureRemotePreview(async()=>{throw Error("disconnected");}),/disconnected/);
});
test("small preview maps to native coordinates and rejects object-fit margins",()=>{
 const g=containedScreenGeometry({left:0,top:0,width:600,height:640},576,1280,1080,2400);
 assert.deepEqual(screenPoint({x:300,y:320},g),{x:540,y:1200});
 assert.equal(screenPoint({x:20,y:320},g),null);
 assert.deepEqual(screenPoint({x:g.left+g.width,y:g.top+g.height},g),{x:1079,y:2399});
});
