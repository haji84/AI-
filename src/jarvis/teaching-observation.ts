import { createHash } from "node:crypto";
import type { DeviceProfile, Observation, TeachingAction, TeachingStep } from "./teaching.ts";
const protectedWords=/購入|支払|決済|契約|削除|送信|投稿|公開|権限|パスワード|ログイン|認証|purchase|pay|checkout|delete|submit|send|publish|permission|password|sign.in|log.in|authorize/i;
const navigation=/^(戻る|ホーム|次へ|前へ|開く|一覧|詳細|検索|閉じる|Back|Home|Next|Previous|Open|Details|Search|Close)$/i;
function decode(s:string){return s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
export function observeAndroidUi(xml:string,profile:DeviceProfile):Observation {
 if(xml.length>2*1024*1024||!/hierarchy/.test(xml))throw Error("UI observation unavailable");
 const nodes=[...xml.matchAll(/<node\b([^>]+)>/g)].map(match=>{const attrs:Record<string,string>={};for(const m of match[1].matchAll(/([\w-]+)="([^"]*)"/g))attrs[m[1]]=decode(m[2]);return attrs;});
 if(!nodes.length||nodes.length>3000)throw Error("UI nodes unavailable or over limit");
 const protectedScreen=nodes.some(n=>n.password==="true"||protectedWords.test((n.text??'')+' '+(n['content-desc']??'')));
 const identity=(n:Record<string,string>)=>`${n.package??''}|${n['resource-id']??''}|${n.class??''}`;
 const targets:Observation['targets']=[];
 for(const n of nodes){const selector=identity(n);const b=n.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);if(!b||!n['resource-id']||n.enabled!=="true"||n.clickable!=="true"||nodes.filter(other=>identity(other)===selector).length!==1)continue;const [left,top,right,bottom]=b.slice(1).map(Number);if(right<=left||bottom<=top||right>20000||bottom>20000)continue;targets.push({selector,left,top,right,bottom,x:Math.floor((left+right)/2),y:Math.floor((top+bottom)/2),safeNavigation:!protectedScreen&&navigation.test(n.text||n['content-desc']||'')});}
 // Persist structure/state hashes, never raw screen text, passwords or screenshots.
 const signature=createHash('sha256').update(JSON.stringify(nodes.map(n=>[identity(n),n.enabled,n.checked,n.selected,n.clickable,n.bounds]))).digest('hex');
 return {signature,profile,targets,protectedScreen};
}
export function demonstratedStep(payload:Record<string,unknown>,before:Observation,after:Observation):TeachingStep {
 let action:TeachingAction={kind:"manual",instruction:"この操作は自動記録対象外です。手動で実行してください"};let gate=true;
 if(payload.action==='tap'&&typeof payload.x==='number'&&typeof payload.y==='number'){
  const targets=before.targets.filter(t=>payload.x as number>=t.left&&(payload.x as number)<t.right&&(payload.y as number)>=t.top&&(payload.y as number)<t.bottom);
  if(targets.length===1){action={kind:'tap',selector:targets[0].selector};gate=!targets[0].safeNavigation;}
 }else if(payload.action==='keyevent'&&['BACK','HOME','APP_SWITCH'].includes(String(payload.key))){action={kind:'key',key:payload.key as 'BACK'};gate=false;
 }else if(payload.action==='open-url'&&typeof payload.url==='string'){
  const u=new URL(payload.url);if(u.protocol==='https:'&&!u.username&&!u.password){action={kind:'url',host:u.hostname};gate=false;}
 }
 return {action,before:before.signature,after:after.signature,contextKey:createHash('sha256').update(JSON.stringify([before.profile.platform,before.profile.model,before.profile.osVersion,before.profile.app,before.profile.appVersion])).digest('hex'),gate:gate||before.protectedScreen||after.protectedScreen};
}
