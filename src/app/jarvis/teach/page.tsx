"use client";
import { useEffect, useState } from "react";
import type { TeachingVariant, TeachingRun } from "../../../jarvis/teaching";
import type { TeachingLearningCandidate } from "../../../jarvis/teaching-learning";
import VideoTeachingPanel from './VideoTeachingPanel';
export default function TeachingLibrary(){
 const [variants,setVariants]=useState<TeachingVariant[]>([]),[runs,setRuns]=useState<TeachingRun[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [candidates,setCandidates]=useState<TeachingLearningCandidate[]>([]);
 const [instructions,setInstructions]=useState(''),[previousInstructions,setPreviousInstructions]=useState<string|null>(null);
 async function load(){const r=await fetch('/api/jarvis/teaching',{cache:'no-store'});const b=await r.json();if(!r.ok)throw Error(b.message);setVariants(b.variants);setRuns(b.runs);setCandidates(b.learningCandidates||[]);}
 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[]);
 async function save(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);const f=new FormData(event.currentTarget);try{const profile=Object.fromEntries(['deviceId','platform','model','osVersion','app','appVersion'].map(k=>[k,f.get(k)]));const r=await fetch('/api/jarvis/teaching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'manual',profile,goal:f.get('goal'),scope:f.get('scope'),instructions:f.get('instructions'),completion:f.get('completion')})});const b=await r.json();if(!r.ok)throw Error(b.message);setMessage('手順を記憶しました。未検証のため自動実行は無効です。');await load();}catch(e){setMessage(e instanceof Error?e.message:'保存失敗');}finally{setBusy(false);}}
 return <main className="jarvis-console jarvis-teaching-library"><h1>全端末の手順ライブラリ</h1><a className="button secondary" href="/jarvis">遠隔操作で実演を記録</a><a className="button secondary" href="/jarvis/devices">Devices</a><p>作業名で共通の目的をまとめ、機種・OS・アプリ・端末ごとの違いを保存します。別端末の実行許可は、検証結果から自動転用しません。</p>
 <section className="panel jarvis-section"><h2>端末ごとの対応</h2><ul><li>Android：接続済みRemote Gatewayから実演記録・観測付き再現。</li><li>Windows / Mac / Linux：手順の保存に対応。自動操作アダプターは未接続です。</li><li>iPhone：手順の保存に対応。OSが許可する操作アダプターの接続が必要です。</li></ul></section>
 <VideoTeachingPanel onApply={value=>{setPreviousInstructions(instructions);setInstructions(value);}}/>
 <form className="panel jarvis-section jarvis-teaching" onSubmit={save}><h2>手順を教えて保存</h2><p>自動記録が使えない端末も、1行1操作で手順を記憶できます。認証情報や個人情報は書かないでください。</p>
 <label>共通の作業名<input name="goal" required maxLength={160}/></label><label>Platform<select name="platform">{['android','ios','windows','macos','linux'].map(p=><option key={p}>{p}</option>)}</select></label>
 {(['deviceId','model','osVersion','app','appVersion'] as const).map((name,i)=><label key={name}>{['端末ID','機種名','OSの版','対象アプリ','アプリの版'][i]}<input name={name} required maxLength={120}/></label>)}
 <label>範囲<select name="scope"><option value="device">この端末固有</option><option value="model">機種別</option><option value="common">共通</option></select></label>
 <label>操作手順<textarea name="instructions" required maxLength={25000} rows={6} value={instructions} onChange={event=>setInstructions(event.target.value)}/></label>{previousInstructions!==null&&<button type="button" className="button secondary" onClick={()=>{setInstructions(previousInstructions);setPreviousInstructions(null);}}>動画の反映を元に戻す</button>}<label>1件の完了条件<input name="completion" required maxLength={500}/></label><button className="button" disabled={busy}>未検証の手順として保存</button><p role="status">{message}</p></form>
 <section className="panel jarvis-section"><h2>記憶した手順</h2>{variants.length===0?<p>まだ手順はありません。</p>:variants.map(v=><details key={v.id}><summary>{v.goal} — {v.profile.model} / {v.profile.platform} / {v.status}</summary><p>{v.profile.deviceId} · OS {v.profile.osVersion} · {v.profile.app} {v.profile.appVersion} · {v.scope}</p><p>完了条件：{v.completion||'未指定'}</p><ol>{v.steps.map((s,i)=><li key={i}>{s.action.kind==='manual'?s.action.instruction:s.action.kind}{s.gate?'（手動対応が必要）':''}</li>)}</ol><p>学習候補：{({OBSERVED:"記録から候補を生成・検証待ち",NEEDS_VALIDATION:"追加の確認が必要",VALIDATED:"同じ端末・環境で3回以上の再現確認あり"})[candidates.find(c=>c.variantId===v.id)?.state||"NEEDS_VALIDATION"]}。候補は自動実行の許可ではありません。誤操作・訂正の対応関係は未確認です。</p><p>変更する場合は新しい実演を保存してください。以前の検証結果は新しい手順へ転用しません。</p></details>)}</section>
 <section className="panel jarvis-section"><h2>再現・実行履歴</h2>{runs.slice(-30).reverse().map(r=><p key={r.id}>{r.deviceId} / {r.mode} / {r.status} / {r.nextStep}手順完了 {r.reason}</p>)}</section></main>;
}
