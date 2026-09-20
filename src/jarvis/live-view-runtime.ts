export type StreamDevice={id:string;online:boolean;capability:"view-only"|"controllable"|"full";preferredFps:number;latencyMs:number;errorRate:number};
export type StreamSlot={deviceId:string;fps:number;intervalMs:number;priority:number};
export class LiveViewScheduler {
  schedule(devices:StreamDevice[],maxConcurrent=9):StreamSlot[]{return devices.filter(d=>d.online).sort((a,b)=>(a.errorRate+a.latencyMs/5000)-(b.errorRate+b.latencyMs/5000)).slice(0,maxConcurrent).map((d,i)=>{const fps=Math.max(1,Math.min(d.preferredFps,d.latencyMs>1000?2:d.errorRate>0.2?1:5));return {deviceId:d.id,fps,intervalMs:Math.ceil(1000/fps),priority:maxConcurrent-i};});}
  backoff(consecutiveFailures:number){return Math.min(30_000,1000*Math.pow(2,Math.min(5,consecutiveFailures)));}
  layout(count:number):"single"|"split2"|"grid4"|"grid"{if(count<=1)return"single";if(count===2)return"split2";if(count<=4)return"grid4";return"grid";}
  loadEstimate(slots:StreamSlot[]){return {framesPerSecond:slots.reduce((a,s)=>a+s.fps,0),concurrent:slots.length};}
}
