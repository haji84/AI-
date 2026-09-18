import type {JarvisNode} from './types.ts';
import {remoteDeviceInventory} from './remote-device-inventory.ts';

/** Owner-authenticated session preparation. Completion acknowledges wake execution,
 * not an unlocked or visually verified screen. The next capture verifies that. */
export async function prepareWorkerRemote(node:JarvisNode, broker:(path:string,init?:RequestInit)=>Promise<Response>, clock={now:Date.now,sleep:(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))}):Promise<'wake-completed'|'wake-unsupported'> {
  const device=remoteDeviceInventory([node],[])[0];
  if(!device.remoteAssistCapability) throw Error(device.reason);
  if(!node.capabilities.includes('wake-device')) {
    if(node.telemetry.screenInteractive===false) throw Error('画面OFFです。このWorkerは遠隔からの画面起動に未対応です');
    return 'wake-unsupported';
  }
  const deadline=clock.now()+18_000;
  const response=await broker('/api/jarvis/admin/remote/wake',{method:'POST',body:JSON.stringify({nodeId:node.id}),signal:AbortSignal.timeout(3_000)});
  if(!response.ok) throw Error('端末の画面起動を開始できません。接続・権限・実行中の作業を確認してください');
  const body=await response.json() as {task?:{id?:string}};
  if(!body.task?.id) throw Error('画面起動の応答が不正です');
  while(clock.now()<deadline) {
    const r=await broker('/api/jarvis/admin/state',{signal:AbortSignal.timeout(Math.min(3_000,Math.max(1,deadline-clock.now())))});
    if(!r.ok) throw Error('画面起動の結果を確認できません');
    const state=await r.json() as {tasks?:{id:string;status:string}[];fleet?:JarvisNode[]};
    const task=state.tasks?.find(t=>t.id===body.task!.id);
    if(clock.now()>=deadline) break;
    if(task?.status==='completed') {
      const current=state.fleet?.find(item=>item.id===node.id);
      if(!current || !remoteDeviceInventory([current],[])[0].remoteAssistCapability) throw Error('画面起動後に接続または操作権限を確認できません');
      return 'wake-completed';
    }
    if(task && ['failed','cancelled','waiting-human'].includes(task.status)) throw Error('画面起動に失敗しました。遠隔操作は開始していません');
    await clock.sleep(400);
  }
  throw Error('画面起動の確認が時間切れになりました。未配送の起動命令は期限切れとなり、操作は開始していません');
}
