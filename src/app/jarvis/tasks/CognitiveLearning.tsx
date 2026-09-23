"use client";
import { useState } from "react";
export type LearningSnapshot={goalId:string|null;historyImportEnabled:boolean;history:{total:number;unverified:number};recentAttempts:{id:string;actionId:string;verified:boolean;success:boolean}[]};
export default function CognitiveLearning({state,disabled,onSaved}:{state:LearningSnapshot;disabled:boolean;onSaved:()=>Promise<unknown>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[original,setOriginal]=useState(""),[replacement,setReplacement]=useState("");
 async function act(operation:string){setBusy(true);setMessage("");try{
  const payload=operation==="correct"?{operation,goalId:state.goalId,originalId:original,replacementId:replacement}:{operation};
  const r=await fetch("/api/jarvis/cognitive/learning",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),data=await r.json();
  if(!r.ok)throw Error(data.message||"学習候補を確認できません");
  setMessage(operation==="import-history"?`履歴候補 ${data.total}件を保存しました。未検証のため学習済みとは扱いません。`:operation==="training-candidate"?`訓練候補 ${data.train}件、検証用 ${data.validation}件、独立評価用 ${data.heldout}件、対象外 ${data.rejected}件。モデル学習は実行していません。`:"検証済みの訂正を保存しました。同じ条件での次回判断に利用します。");await onSaved();
 }catch(e){setMessage(e instanceof Error?e.message:"学習状態を確認してください");}finally{setBusy(false);}}
 if(!state.history)return <p className="muted">接続先では学習候補の画面にまだ対応していません。現在のGoal操作は引き続き利用できます。</p>;
 return <details><summary>学習・訂正</summary><p>保存した履歴候補 {state.history.total}件（未検証 {state.history.unverified}件）</p>
  <button className="button secondary" disabled={disabled||busy||!state.historyImportEnabled} onClick={()=>void act("import-history")}>設定済みの履歴を取り込む</button>
  <button className="button secondary" disabled={disabled||busy} onClick={()=>void act("training-candidate")}>学習候補を確認</button>
  <fieldset className="jarvis-task-form" style={{gridTemplateColumns:"minmax(0,1fr)",minWidth:0}} disabled={disabled||busy}><legend>実行結果の訂正</legend><p className="muted">このGoalで実行した操作と、正しかった検証済み操作を選んでください。</p>
   <label style={{display:"grid",gap:6,minWidth:0}}>修正前<select style={{width:"100%"}} value={original} onChange={e=>setOriginal(e.target.value)}><option value="">選択してください</option>{state.recentAttempts.map(a=><option key={a.id} value={a.id}>{a.actionId.slice(0,50)} — {a.verified?"検証済み":"未達成"}</option>)}</select></label>
   <label style={{display:"grid",gap:6,minWidth:0}}>正しい結果<select style={{width:"100%"}} value={replacement} onChange={e=>setReplacement(e.target.value)}><option value="">選択してください</option>{state.recentAttempts.filter(a=>a.verified&&a.success).map(a=><option key={a.id} value={a.id}>{a.actionId.slice(0,50)}</option>)}</select></label>
   <button className="button secondary" disabled={!original||!replacement||original===replacement||!state.goalId} onClick={()=>void act("correct")}>この訂正を覚える</button>
  </fieldset><p role="status" aria-live="polite">{message}</p></details>;
}
