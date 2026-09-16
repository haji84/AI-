"use client";
import { useCallback, useEffect, useState } from "react";
import type { TeachingVariant, TeachingRun } from "../../jarvis/teaching";
export default function TeachingControls({serial,sessionId}:{serial:string;sessionId?:string}){
 const [variants,setVariants]=useState<TeachingVariant[]>([]),[goal,setGoal]=useState(''),[completion,setCompletion]=useState(''),[scope,setScope]=useState('device'),[selected,setSelected]=useState(''),[url,setUrl]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{try{const r=await fetch('/api/jarvis/teaching',{cache:'no-store'});const b=await r.json();if(!r.ok)throw Error(b.message);setVariants(b.variants);}catch(e){setMessage(e instanceof Error?e.message:'読込失敗');}},[]);
 useEffect(()=>{void refresh();},[refresh,sessionId]);
 const recording=variants.find(v=>v.status==='RECORDING'&&v.sessionId===sessionId);
 async function command(action:string){setBusy(true);try{const r=await fetch('/api/jarvis/remote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,serial,sessionId,goal,scope,completion,variantId:selected,url})});const b=await r.json();if(!r.ok)throw Error(b.message||b.detail||'教示操作に失敗しました');const run=b.run as TeachingRun|undefined;setMessage(run?`${run.status}：${run.reason??'記録した完了画面まで再現できました'}`:action==='teach-start'?'記録中：JARVISの操作画面から1件分を操作してください。':'保存しました');if(b.variant)setSelected(b.variant.id);await refresh();}catch(e){setMessage(e instanceof Error?e.message:'操作失敗');}finally{setBusy(false);}}
 return <section className="panel jarvis-section jarvis-teaching"><h2>操作を教える</h2><p>全機種共通の手順記憶。ここではJARVIS経由の操作を記録します。端末を直接触った操作や動画だけからの自動学習は未対応です。</p>
 <a className="button secondary" href="/jarvis/teach">全端末の手順ライブラリ</a>
 {!sessionId?<p>Remote Assistを開始すると実演を記録できます。</p>:<>
 <label>共通の作業名<input value={goal} onChange={e=>setGoal(e.target.value)} placeholder="スプレッドシートのURLを開く" maxLength={160}/></label>
 <label>手順の範囲<select value={scope} onChange={e=>setScope(e.target.value)}><option value="device">この端末固有</option><option value="model">同機種用（端末ごとに再検証）</option><option value="common">共通（互換性のある操作のみ）</option></select></label>
 <button className="button" disabled={busy||!goal||!!recording} onClick={()=>void command('teach-start')}>記録開始</button>
 {recording&&<><strong>記録中：{recording.goal}</strong><label>どの状態なら1件完了？<input value={completion} onChange={e=>setCompletion(e.target.value)} maxLength={500} placeholder="例：処理結果の画面が表示される"/></label><button className="button" disabled={busy||!completion} onClick={()=>void command('teach-finish')}>ここで1件完了・保存</button><button className="button secondary" disabled={busy} onClick={()=>void command('teach-cancel')}>記録を中止</button></>}
 <label>保存手順<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">選択してください</option>{variants.filter(v=>v.status!=='RECORDING').map(v=><option key={v.id} value={v.id}>{v.goal} / {v.profile.model} / {v.profile.platform} / {v.status}</option>)}</select></label>
 <label>今回処理するHTTPS URL（URL操作がある場合）<input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></label>
 <p>開始画面へ戻してから再現テストしてください。別機種・OS更新・アプリ更新・未検証端末は自動実行しません。購入・削除などの重要操作、判別できない操作は手動で対応します。</p>
 <button className="button secondary" disabled={busy||!selected||!!recording} onClick={()=>void command('teach-verify')}>この端末で再現テスト</button>
 <button className="button" disabled={busy||!selected||!!recording} onClick={()=>void command('teach-execute')}>検証済み手順を自動実行</button>
 </>}
 <p role="status">{busy?'画面を確認しています… ':''}{message}</p></section>;
}

