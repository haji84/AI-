import test from "node:test";
import assert from "node:assert/strict";
import { VideoPacketParser, avcCodec } from "../src/jarvis/video-packets.ts";
function packet(data: number[], flag: number, pts=1234) {const b=Buffer.alloc(12+data.length);b.writeUInt32BE(flag,0);b.writeUInt32BE(pts,4);b.writeUInt32BE(data.length,8);b.set(data,12);return b;}
test("video framing survives every network split and preserves config/key/timestamp",()=>{
 const input=Buffer.concat([packet([0,0,0,1,103,66,0,31,1],0x80000000,0),packet([0,0,1,101,1],0x40000000)]);
 for(let split=1;split<input.length;split++){const p=new VideoPacketParser();const frames=[...p.push(input.subarray(0,split)),...p.push(input.subarray(split))];assert.equal(frames.length,2);assert(frames[0].config);assert(frames[1].key);assert.equal(frames[1].timestamp,1234);assert.equal(avcCodec(frames[0].data),'avc1.42001f');}
});
test("invalid video packet lengths and missing SPS fail closed",()=>{
 const large=Buffer.alloc(12);large.writeUInt32BE(4*1024*1024+1,8);
 for(const b of [large,Buffer.alloc(12),Buffer.alloc(4*1024*1024+13)])assert.throws(()=>new VideoPacketParser().push(b));
 assert.throws(()=>avcCodec(new Uint8Array([0,0,1,101,0,0,0,0])));
});
