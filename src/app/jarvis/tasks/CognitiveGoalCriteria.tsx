"use client";
import { useId, useState } from "react";
interface Proposal { status: "PROPOSED"; verification: "UNVERIFIED"; draft: { successCriteria: string[]; assumptions: string[]; unresolvedQuestions: Array<{question:string;impact:string}> } }
export default function CognitiveGoalCriteria({state,disabled,onSaved}:{state:{goalId:string|null;goalDigest:string|null;goalRefinementAvailable?:boolean};disabled:boolean;onSaved:()=>Promise<unknown>}){
 const criteriaId=useId();
 const [text,setText]=useState(""),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [proposal,setProposal]=useState<Proposal|null>(null);
 if(!state.goalRefinementAvailable)return null;
 const criteria=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 async function propose(){setBusy(true);setMessage("");setProposal(null);try{
  const r=await fetch("/api/jarvis/cognitive/goal/proposal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goalId:state.goalId,goalDigest:state.goalDigest})}),data=await r.json();
  if(!r.ok)throw Error(data.message||"ローカルAIを利用できません。完了条件は手入力できます。");
  if(data.status!=="PROPOSED"||data.verification!=="UNVERIFIED"||!Array.isArray(data.draft?.successCriteria))throw Error("候補を確認できません。完了条件は手入力できます。");
  setProposal(data);
 }catch(e){setMessage(e instanceof Error?e.message:"候補を確認できません。完了条件は手入力できます。");}finally{setBusy(false);}}
 async function save(){setBusy(true);setMessage("");try{
  const r=await fetch("/api/jarvis/cognitive/goal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goalId:state.goalId,goalDigest:state.goalDigest,successCriteria:criteria,acknowledgement:ack})}),data=await r.json();
  if(!r.ok)throw Error(data.message||"完了条件を保存できません");await onSaved();
 }catch(e){setMessage(e instanceof Error?e.message:"Goalを確認してください");}finally{setBusy(false);}}
 return <section aria-label="Goalの完了条件"><h3>何ができれば完了ですか</h3><p className="muted">現在の目標に必要な成果を1行ずつ入力してください。実行前のGoalへ追加し、達成の確認は成果物を作成した後に行います。</p>
  <button className="button secondary" disabled={disabled||busy} onClick={()=>void propose()}>ローカルAIに完了条件を提案してもらう</button>
  {proposal&&<div role="region" aria-label="未検証の完了条件候補"><h4>未検証の候補</h4><p>依頼と合うか確認し、必要なら編集してください。候補の生成だけでは登録・実行されません。</p>
   <ul>{proposal.draft.successCriteria.map((c,i)=><li key={i}>{c}</li>)}</ul>
   {proposal.draft.assumptions.length>0&&<><h4>前提としていること</h4><ul>{proposal.draft.assumptions.map((c,i)=><li key={i}>{c}</li>)}</ul></>}
   {proposal.draft.unresolvedQuestions.length>0&&<><h4>まだ不明なこと</h4><ul>{proposal.draft.unresolvedQuestions.map((q,i)=><li key={i}>{q.question}</li>)}</ul></>}
   <button className="button secondary" disabled={disabled||busy} onClick={()=>{setText(proposal.draft.successCriteria.join("\n"));setAck(false);}}>候補を入力欄に使う</button>
  </div>}
  <div style={{display:"grid",gap:8}}><label htmlFor={criteriaId}>完了条件（1行1条件）</label><textarea id={criteriaId} value={text} maxLength={8016} rows={4} disabled={disabled||busy} style={{width:"100%",boxSizing:"border-box",background:"var(--panel,#081625)",color:"inherit"}} onChange={e=>{setText(e.target.value);setAck(false);}}/></div>
  <label style={{display:"block"}}><input type="checkbox" checked={ack} disabled={disabled||busy} onChange={e=>setAck(e.target.checked)}/>この条件で、依頼した目標の完了を確認できます。</label>
  <button className="button secondary" disabled={disabled||busy||!ack||!criteria.length||criteria.length>16||criteria.some(c=>c.length>500)} onClick={()=>void save()}>完了条件を登録</button><p role="status" aria-live="polite">{message}</p>
 </section>;
}
