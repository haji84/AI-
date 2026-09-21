"use client";
import { useEffect, useRef, useState } from "react";
import { VideoPacketParser, avcCodec } from "../../jarvis/video-packets";
import { ScreenGestureTracker, containedScreenGeometry, type ScreenInput } from "../../jarvis/remote-screen-input";
export default function RemoteVideo({ serial, sessionId, onStop, nativeWidth, nativeHeight, controllable, onInput }: { serial: string; sessionId: string; onStop: () => void; nativeWidth?: number; nativeHeight?: number; controllable: boolean; onInput: (input: ScreenInput) => void }) {
 const canvas = useRef<HTMLCanvasElement>(null);
 const tracker=useRef(new ScreenGestureTracker());
 const streaming=useRef(false);
 const geometry=()=>{const c=canvas.current!;return containedScreenGeometry(c.getBoundingClientRect(),c.width,c.height,nativeWidth??0,nativeHeight??0)};
 const canInput=()=>{const c=canvas.current;return streaming.current&&controllable&&c&&nativeWidth&&nativeHeight&&Math.abs(c.width/c.height-nativeWidth/nativeHeight)<0.02};
 const [status,setStatus]=useState("動画接続中…");
 useEffect(()=>{
  const abort=new AbortController();let decoder:VideoDecoder|undefined;let alive=true;let frames=0;
  const hidden=()=>{if(document.visibilityState!=="visible")abort.abort()};document.addEventListener("visibilitychange",hidden);
  void(async()=>{
   if(!("VideoDecoder" in window))throw Error("このブラウザーは動画表示非対応です。画像更新を利用してください");
   decoder=new VideoDecoder({output(frame){try{const c=canvas.current;if(c&&alive){c.width=frame.displayWidth;c.height=frame.displayHeight;c.getContext("2d")?.drawImage(frame,0,0);streaming.current=true;frames++;if(frames===1)setStatus("動画 LIVE（最大60秒）");}}finally{frame.close();}},error(){abort.abort();}});
   const response=await fetch("/api/jarvis/remote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"video",serial,sessionId}),signal:abort.signal});
   if(!response.ok||!response.body)throw Error("動画を開始できません。画像更新を利用してください");
   const reader=response.body.getReader();const parser=new VideoPacketParser();let config=new Uint8Array(0);let keyNeeded=true;
   while(!abort.signal.aborted){const part=await reader.read();if(part.done)break;
    for(const packet of parser.push(part.value)){
     if(packet.config){config=new Uint8Array(packet.data);const codec=avcCodec(config);const settings={codec,optimizeForLatency:true};const supported=await VideoDecoder.isConfigSupported(settings);if(!supported.supported)throw Error("動画形式が非対応です");decoder.configure(settings);keyNeeded=true;continue;}
     if(decoder.state!=="configured")continue;
     if(decoder.decodeQueueSize>3)throw Error("動画受信が遅れたため停止しました。再接続してください");
     if(keyNeeded&&!packet.key)continue;
     let data=packet.data;if(packet.key){data=new Uint8Array(config.length+packet.data.length);data.set(config);data.set(packet.data,config.length);keyNeeded=false;}
     decoder.decode(new EncodedVideoChunk({type:packet.key?"key":"delta",timestamp:packet.timestamp,data}));
    }
   }
   if(alive)setStatus(frames?"動画終了：再開ボタンで接続してください":"動画を受信できませんでした");
  })().catch(error=>{if(alive)setStatus(abort.signal.aborted?"動画停止：再開してください":error.message);}).finally(()=>{streaming.current=false;tracker.current.cancel();abort.abort();if(decoder&&decoder.state!=="closed")decoder.close();});
  return()=>{alive=false;streaming.current=false;abort.abort();document.removeEventListener("visibilitychange",hidden);if(decoder&&decoder.state!=="closed")decoder.close();};
 },[serial,sessionId]);
 return <section><p role="status">{status}</p><div className="jarvis-remote-screen jarvis-remote-video-screen"><canvas ref={canvas} style={{width:"100%",maxHeight:640,objectFit:"contain",touchAction:controllable?"none":"auto"}} aria-label="端末の動画画面：タップ・スワイプ"
 onPointerDown={e=>{if(canInput()&&e.button===0&&tracker.current.begin(e.pointerId,e.isPrimary,{x:e.clientX,y:e.clientY},geometry(),performance.now()))e.currentTarget.setPointerCapture(e.pointerId);}}
 onPointerUp={e=>{if(!canInput()){tracker.current.cancel();return;}const input=tracker.current.finish(e.pointerId,{x:e.clientX,y:e.clientY},geometry(),performance.now());if(input)onInput(input);}}
 onPointerCancel={()=>tracker.current.cancel()} onLostPointerCapture={()=>tracker.current.cancel()}
 /></div><button className="button secondary" onClick={onStop}>動画を終了して画像操作へ戻る</button><p>動画表示中も下の戻る・ホーム・スワイプ操作が使えます。端末を回転した場合は画像操作へ戻してください。</p></section>;
}
