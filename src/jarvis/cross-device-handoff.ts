export type HandoffCheckpoint={jobId:string;goal:string;step:string;state:Record<string,unknown>;requiredCapabilities:string[];createdAt:string;sourceDeviceId:string;version:number};
export type HandoffDevice={id:string;online:boolean;capabilities:string[];trusted:boolean;load:number};
export class CrossDeviceHandoff {
  choose(checkpoint:HandoffCheckpoint,devices:HandoffDevice[]){
    const eligible=devices.filter(d=>d.online&&d.trusted&&checkpoint.requiredCapabilities.every(c=>d.capabilities.includes(c))).sort((a,b)=>a.load-b.load);
    return eligible[0]??null;
  }
  resume(checkpoint:HandoffCheckpoint,target:HandoffDevice){
    if(!target.trusted||!target.online)throw new Error("handoff target unavailable");
    if(!checkpoint.requiredCapabilities.every(c=>target.capabilities.includes(c)))throw new Error("handoff target lacks capability");
    return {...checkpoint,sourceDeviceId:target.id,version:checkpoint.version+1,createdAt:new Date().toISOString()};
  }
}
