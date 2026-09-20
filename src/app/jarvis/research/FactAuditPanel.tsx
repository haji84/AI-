'use client';
import { useState } from 'react';
type Audit={id:string;createdAt:string;audits:{claim:{id:string;text:string};status:string;reasons:string[]}[];citations:{id:string;title:string;passage:string;url?:string}[]};
export default function FactAuditPanel(){
 const [text,setText]=useState(''),[passage,setPassage]=useState(''),[title,setTitle]=useState(''),[url,setUrl]=useState('');
 const [records,setRecords]=useState<Audit[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function run(load=false){setBusy(true);setMessage('');try{
  const response=await fetch('/api/jarvis/facts',load?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,sources:passage?[{title:title||'提供資料',passage,...(url?{url}:{})}]:[]})});
  if(!response.ok)throw Error(response.status===401?'オーナー認証が必要です':response.status===400?'本文・資料の長さやURLを確認してください':'検証記録を保存・取得できません');
  const data=await response.json();setRecords(load?data.audits:[data,...records]);setMessage(load?'保存済み記録を読み込みました':'監査結果を保存しました。独立した事実確認は未完了です');
 }catch(e){setMessage(e instanceof Error?e.message:'処理に失敗しました');}finally{setBusy(false);}}
 return <section className="panel jarvis-section"><h2>主張と根拠の監査</h2>
 <p>提供された文章と資料の対応を整理します。資料の真正性・内容の正しさは未確認です。URLの自動取得は行いません。秘密情報は入力しないでください。</p>
 <form style={{display:"grid",gap:"0.75rem"}} onSubmit={e=>{e.preventDefault();void run();}}>
 <label style={{display:"grid",gap:"0.3rem"}}>確認する文章<textarea required maxLength={12000} value={text} onChange={e=>setText(e.target.value)} style={{display:'block',width:'100%'}} /></label>
 <label style={{display:"grid",gap:"0.3rem"}}>資料名<input maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} /></label>
 <label style={{display:"grid",gap:"0.3rem"}}>資料の本文<textarea maxLength={3000} value={passage} onChange={e=>setPassage(e.target.value)} style={{display:'block',width:'100%'}} /></label>
 <label style={{display:"grid",gap:"0.3rem"}}>出典URL（任意・HTTPS、認証情報なし）<input type="url" maxLength={1000} value={url} onChange={e=>setUrl(e.target.value)} style={{width:'100%'}} /></label>
 <button disabled={busy} type="submit">監査して保存</button><button disabled={busy} type="button" onClick={()=>void run(true)}>保存した監査を開く</button>
 </form><p role="status">{message}</p>
 {records.map(r=><article key={r.id}><h3>{new Date(r.createdAt).toLocaleString('ja-JP')}</h3><p>根拠の信頼状態：未検証</p>
 {r.audits.map(a=><div key={a.claim.id}><strong>{a.status==='INFERRED'?'参考資料との一致候補':a.status==='UNKNOWN'?'根拠不足':a.status}</strong><p>{a.claim.text}</p></div>)}
 <h4>提供資料</h4>{r.citations.map(c=><details key={c.id}><summary>{c.title}（提供元の申告・未取得）</summary><p>{c.passage}</p>{c.url&&<p>{c.url}</p>}</details>)}
 </article>)}
 </section>;
}
