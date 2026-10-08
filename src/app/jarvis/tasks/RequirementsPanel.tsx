"use client";
import {useCallback,useEffect,useId,useRef,useState} from "react";
import "./requirements-panel.css";

type RecordView={adopted:boolean;withdrawalPending:boolean;id:string;statement:string;state:string;displayState:string;canonicalIds:string[];matches:{id:string}[];conversation?:{message:string};publicationUrl?:string|null;gateReasons:string[]};
type Requirement={id:string;title:string};
type Payload={records:RecordView[];requirements:Requirement[];publishAvailable:boolean};
type Preview={decisionId:string;review:unknown;requirementIds:string[];summary:string;autoMerge:false};
const labels:Record<string,string>={IDEA:"検討メモ",PROPOSED:"候補・未採用",ACCEPTED_REQUIREMENT:"採用済み・反映待ち",REVIEW_PENDING:"変更案を作成済み",SPEC_SYNCED:"正本反映済み",IMPLEMENTED:"実装済み・検証待ち",VERIFIED:"必要な検証を完了",SUPERSEDED:"後の指示で変更済み",WITHDRAWN:"撤回済み",HUMAN_GATE:"権限などの確認が必要"};
function errorMessage(message:string):string{
 const messages:Record<string,string>={github_write_unavailable:"仕様の配信連携が未接続です。要求は保存されています。",requirement_human_gate_required:"権限・認証などに関わる変更のため、専用の承認が必要です。","additional inventory base conflict":"追加台帳が更新されました。もう一度内容を確認してください。",canonical_base_conflict:"正本が更新されました。もう一度内容を確認してください。"};
 return messages[message]??"仕様の処理に失敗しました。要求は削除されていません。再読み込みして確認してください。";
}
export default function RequirementsPanel(){
 const inputId=useId(),[data,setData]=useState<Payload|null>(null),[text,setText]=useState(""),[reference,setReference]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const pending=useRef<{fingerprint:string;key:string}|null>(null);
 const [selection,setSelection]=useState<Record<string,string>>({}),[preview,setPreview]=useState<Preview|null>(null);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  setLoading(true);
  try{
   const response=await fetch("/api/jarvis/requirements",{cache:"no-store",signal:signal??AbortSignal.timeout(10000)});
   if(response.status===401)throw Error("OWNER_AUTH");
   if(!response.ok)throw Error("unavailable");
   const body=await response.json() as Payload;
   if(!Array.isArray(body.records)||!Array.isArray(body.requirements))throw Error("invalid");
   setData(body);setError("");
  }catch(e){if(signal?.aborted)return;setData(null);setError(e instanceof Error&&e.message==="OWNER_AUTH"?"オーナー認証が必要です。":"要求の状態を取得できません。再読み込みしてください。");}
  finally{if(!signal?.aborted)setLoading(false);}
 },[]);
 useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);return()=>controller.abort();},[refresh]);
 async function submit(){
  if(!text.trim()||busy)return;setBusy(true);setPreview(null);setError("");
  const fingerprint=JSON.stringify({text,reference});
  if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,key:crypto.randomUUID()};
  try{
   const response=await fetch("/api/jarvis/work",{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(15000),body:JSON.stringify({text,idempotencyKey:pending.current.key,...(reference?{requirementReferenceId:reference}:{})})});
   const body=await response.json();
   if(!response.ok)throw Error(body.message??"unavailable");
   setNotice(body.conversation?.message??"依頼を受け付けました。");
   if(body.conversation?.needsClarification){pending.current=null;await refresh();return;}
   if(!body.requirement){setNotice("通常の依頼として受け付けました。仕様の追加は「〇〇できる機能を追加して」と入力できます。");}
   pending.current=null;setText("");setReference("");await refresh();
  }catch{setError("依頼を保存できませんでした。内容を残しているので再送できます。");}
  finally{setBusy(false);}
 }
 async function confirmPreview(record:RecordView){
  const choice=record.withdrawalPending?"history":selection[record.id]??record.canonicalIds[0]??"";
  if(!choice){setError("既存の仕様か、新しい要件かを選択してください。");return;}
  setBusy(true);setError("");setPreview(null);
  try{
   const response=await fetch("/api/jarvis/requirements",{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(15000),body:JSON.stringify({action:"preview",decisionId:record.id,choice:choice==="history"?{mode:"history"}:choice==="new"?{mode:"new"}:{mode:"existing",id:choice}})});
   const body=await response.json();if(!response.ok)throw Error(body.message??"unavailable");
   setPreview({decisionId:record.id,review:body.review,requirementIds:body.requirementIds,summary:body.summary,autoMerge:false});
  }catch(e){setError(errorMessage(e instanceof Error?e.message:""));}
  finally{setBusy(false);}
 }
 async function publish(){
  if(!preview||busy)return;setBusy(true);setError("");
  try{
   const response=await fetch("/api/jarvis/requirements",{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(55000),body:JSON.stringify({decisionId:preview.decisionId,review:preview.review})});
   const body=await response.json();if(!response.ok)throw Error(body.message??"unavailable");
   setNotice("仕様の変更案を保存しました。検証と正本への反映が終わるまで、完了にはしません。");setPreview(null);await refresh();
  }catch(e){setError(errorMessage(e instanceof Error?e.message:""));}
  finally{setBusy(false);}
 }
 return <section className="panel jarvis-section requirements-panel" aria-labelledby={inputId+"-heading"}>
  <header className="jarvis-screen-heading compact"><div><p className="eyebrow">LIVING SPECIFICATION</p><h2 id={inputId+"-heading"}>仕様・要望</h2><p className="muted">追加したい機能や変更を伝えると、採用内容と反映状況をここに残します。</p></div><button className="button secondary" type="button" disabled={busy||loading} onClick={()=>void refresh()}>再読み込み</button></header>
  <form className="requirements-input" onSubmit={e=>{e.preventDefault();void submit();}}>
   <label htmlFor={inputId}>追加・変更したいこと</label><textarea id={inputId} maxLength={4000} rows={3} placeholder="例：通知音を変更できる機能を追加して" value={text} onChange={e=>setText(e.target.value)} disabled={busy}/>
   <label htmlFor={inputId+"-reference"}>「それ」「さっきの仕様」が指す要求</label><select id={inputId+"-reference"} value={reference} onChange={e=>setReference(e.target.value)} disabled={busy}><option value="">文脈から判断（候補が複数なら確認）</option>{data?.records.filter(r=>!r.adopted&&!["SUPERSEDED","WITHDRAWN"].includes(r.displayState)).map(r=><option key={r.id} value={r.id}>{r.statement.slice(0,80)}</option>)}</select>
   <button className="button primary" type="submit" disabled={busy||!text.trim()}>{busy?"処理中…":"JARVISに伝える"}</button>
  </form>
  {notice&&<p className="requirements-notice" role="status">{notice}</p>}
  {error&&<div className="jarvis-alert" role="alert"><span>{error}</span>{error.includes("認証")&&<a href="/jarvis/login?next=/jarvis/tasks">オーナー認証を開く</a>}</div>}
  <div className="requirements-list">{loading&&!data?<p>読み込み中…</p>:data?.records.length===0?<p className="muted">保存された要求はまだありません。</p>:data?.records.map(r=><article className="requirements-record" key={r.id}>
   <span className="requirements-state">{labels[r.displayState]??"状態を確認中"}</span><h3>{r.statement}</h3>
   {r.conversation?.message&&<p className="muted">{r.conversation.message}</p>}
   {!r.adopted&&["IDEA","PROPOSED"].includes(r.state)&&<button className="button secondary" type="button" disabled={busy} onClick={()=>{setReference(r.id);setText("それで進めて");}}>この案を採用する</button>}
   {r.displayState==="ACCEPTED_REQUIREMENT"&&<div className="requirements-choice">{r.withdrawalPending?<p>元の仕様とIDを残し、撤回の履歴を反映します。</p>:<><label htmlFor={r.id}>対応する仕様</label><select id={r.id} value={selection[r.id]??r.canonicalIds[0]??""} onChange={e=>{setSelection({...selection,[r.id]:e.target.value});setPreview(null);}} disabled={busy}><option value="">選択してください</option><option value="new">新しい要件として追加（新規ID）</option><optgroup label="関連候補（意味の一致は未確定）">{r.matches.map(m=>{const q=data?.requirements.find(v=>v.id===m.id);return q?<option key={q.id} value={q.id}>{q.id} · {q.title}</option>:null;})}</optgroup><optgroup label="すべての仕様">{data?.requirements.map(q=><option key={q.id} value={q.id}>{q.id} · {q.title}</option>)}</optgroup></select></>}<button className="button secondary" type="button" disabled={busy} onClick={()=>void confirmPreview(r)}>反映内容を確認</button></div>}
   {r.displayState==="HUMAN_GATE"&&<p>認証や権限に関わるため、通常の仕様更新から自動反映しません。</p>}
   {r.displayState==="SPEC_SYNCED"&&<p>正本への保存が確認できました。機能の実装・動作検証は別に確認します。</p>}
   {r.publicationUrl&&<details><summary>反映記録</summary><a href={r.publicationUrl} target="_blank" rel="noreferrer">変更案の記録を開く</a></details>}
  </article>)}</div>
  {preview&&<section className="requirements-preview" aria-label="仕様の反映内容"><h3>反映内容</h3><p>{preview.summary}</p><p>要件ID: {preview.requirementIds.length?preview.requirementIds.join("、"):"新規IDは発行しません（撤回履歴のみ）"}</p><p className="muted">変更案を保存し、検証へ進めます。機能そのものが完成した扱いにはなりません。</p>{!data?.publishAvailable&&<p>仕様の配信連携が未接続です。要求は保存済みです。連携後に再度反映内容を確認してください。</p>}<button className="button primary" disabled={busy||!data?.publishAvailable} type="button" onClick={()=>void publish()}>この内容で仕様に反映する</button></section>}
 </section>;
}
