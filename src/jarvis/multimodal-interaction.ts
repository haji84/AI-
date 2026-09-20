export type ContextItem={id:string;label:string;kind:string;selectedAt?:string;createdAt:string};
export type GestureObservation={name:string;confidence:number;stableMs:number;distanceMeters?:number};
export class MultimodalInteractionEngine {
  resolveReference(text:string,items:ContextItem[]):ContextItem|null{
    const sorted=[...items].sort((a,b)=>Date.parse(b.selectedAt||b.createdAt)-Date.parse(a.selectedAt||a.createdAt));
    if(/^(これ|それ|this|that)$/i.test(text.trim())) return sorted[0]??null;
    if(/さっき|previous|last/i.test(text)) return sorted[1]??sorted[0]??null;
    const m=text.match(/(\d+)番/); if(m){const idx=Number(m[1])-1;return idx>=0?sorted[idx]??null:null;}
    return items.find(i=>text.includes(i.label))??null;
  }
  voiceToGoal(transcript:string){const text=transcript.trim();if(!text)return {accepted:false,reason:"empty"};return {accepted:true,goal:text,source:"voice" as const};}
  gestureDecision(obs:GestureObservation){if(obs.confidence<0.85||obs.stableMs<500)return {accepted:false,requiresConfirm:false};const destructive=/delete|reset|shutdown|削除|初期化/i.test(obs.name);return {accepted:!destructive,requiresConfirm:destructive,action:obs.name};}
  distanceProfile(distanceMeters:number){const d=Math.max(0.5,Math.min(8,distanceMeters));return {distanceMeters:d,scale:d>=5?1.8:d>=3?1.5:d>=2?1.25:1,minimumTargetPx:d>=3?64:44};}
  accessibilityAudit(input:{keyboard:boolean;captions:boolean;contrastRatio:number;targetPx:number;labels:boolean}){const issues:string[]=[];if(!input.keyboard)issues.push("keyboard-navigation");if(!input.captions)issues.push("captions");if(input.contrastRatio<4.5)issues.push("contrast");if(input.targetPx<44)issues.push("target-size");if(!input.labels)issues.push("accessible-labels");return {pass:issues.length===0,issues};}
}
