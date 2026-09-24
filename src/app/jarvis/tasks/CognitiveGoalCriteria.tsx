"use client";
import { useState } from "react";
export default function CognitiveGoalCriteria({state,disabled,onSaved}:{state:{goalId:string|null;goalDigest:string|null;goalRefinementAvailable?:boolean};disabled:boolean;onSaved:()=>Promise<unknown>}){
 const [text,setText]=useState(""),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 if(!state.goalRefinementAvailable)return null;
 const criteria=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 async function save(){setBusy(true);setMessage("");try{
  const r=await fetch("/api/jarvis/cognitive/goal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goalId:state.goalId,goalDigest:state.goalDigest,successCriteria:criteria,acknowledgement:ack})}),data=await r.json();
  if(!r.ok)throw Error(data.message||"完了条件を保存できません");await onSaved();
 }catch(e){setMessage(e instanceof Error?e.message:"Goalを確認してください");}finally{setBusy(false);}}
 return <section aria-label="Goalの完了条件"><h3>何ができれば完了ですか</h3><p className="muted">現在の目標に必要な成果を1行ずつ入力してください。実行前のGoalへ追加し、達成の確認は成果物を作成した後に行います。</p>
  <label style={{display:"grid",gap:8}}>完了条件（1行1条件）<textarea value={text} maxLength={8016} rows={4} disabled={disabled||busy} style={{width:"100%",boxSizing:"border-box",background:"var(--panel,#081625)",color:"inherit"}} onChange={e=>{setText(e.target.value);setAck(false);}}/></label>
  <label style={{display:"block"}}><input type="checkbox" checked={ack} disabled={disabled||busy} onChange={e=>setAck(e.target.checked)}/>この条件で、依頼した目標の完了を確認できます。</label>
  <button className="button secondary" disabled={disabled||busy||!ack||!criteria.length||criteria.length>16||criteria.some(c=>c.length>500)} onClick={()=>void save()}>完了条件を登録</button><p role="status" aria-live="polite">{message}</p>
 </section>;
}
