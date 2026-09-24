"use client";
import { useState } from "react";
export type MaterialSnapshot = { goalId: string | null; goalDigest: string | null; busy: boolean; materialIntakeEnabled: boolean; criteria: {id:string;description:string}[]; materials: {id:string;outputs:{id:string;format:string;criteria:string[]}[]} | null };
type Draft = { name:string;content:string;format:"text"|"workbook-json"|"document-json";criteria:string[] };
export default function CognitiveMaterials({state,disabled,onSaved}:{state:MaterialSnapshot;disabled:boolean;onSaved:()=>Promise<unknown>}) {
 const [drafts,setDrafts]=useState<Draft[]>([]),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function selectFiles(files:FileList|null){
  setMessage("");setAck(false);setDrafts([]);
  try{
   if(!files?.length)return;if(files.length>8)throw Error("材料は一度に8件までです");
   let total=0;const selected:Draft[]=[];
   for(const file of Array.from(files)){
    total+=file.size;if(file.size>65536||total>131072)throw Error("1件64KiB、合計128KiBまでの材料を選んでください");
    if(!/\.(txt|md|csv|json)$/i.test(file.name))throw Error("テキスト、Markdown、CSV、構造化JSONを選んでください");
    const content=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
    let format:Draft["format"]="text";
    if(/\.json$/i.test(file.name)){try{const data=JSON.parse(content);if(data&&Array.isArray(data.cells))format="workbook-json";else if(data&&typeof data.title==="string"&&data.sections)format="document-json";}catch{throw Error("JSONの形式を確認してください");}}
    selected.push({name:file.name,content,format,criteria:[]});
   }setDrafts(selected);
  }catch(e){setMessage(e instanceof Error?e.message:"材料を読み込めません");}
 }
 async function submit(){
  if(!state.goalId||!state.goalDigest||!ack)return;setBusy(true);setMessage("材料を確認して保存しています…");
  try{
   const r=await fetch("/api/jarvis/cognitive/materials",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goalId:state.goalId,goalDigest:state.goalDigest,materials:drafts.map(({content,format,criteria})=>({content,format,criteria})),mappingAcknowledged:true})});
   const data=await r.json();if(!r.ok)throw Error(data.message||"材料を登録できません");
   setDrafts([]);setAck(false);setMessage("材料を保存しました。「現在のGoalを続ける」で作成と検証を進められます。");await onSaved();
  }catch(e){setMessage(e instanceof Error?e.message:"材料の状態を確認してください");}finally{setBusy(false);}
 }
 async function download(outputId:string){
  setBusy(true);setMessage("");
  try{
   const r=await fetch(`/api/jarvis/cognitive/materials?goalId=${encodeURIComponent(state.goalId!)}&outputId=${encodeURIComponent(outputId)}`,{cache:"no-store"});
   if(!r.ok)throw Error((await r.json()).message||"成果物はまだ検証されていません");
   const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=r.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]||"output.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage("検証済み成果物を取得しました");
  }catch(e){setMessage(e instanceof Error?e.message:"成果物を取得できません");}finally{setBusy(false);}
 }
 if(!state.materialIntakeEnabled)return null;
 return <section aria-label="ローカル作業の材料"><h3>材料から成果物を作る</h3>
  <p className="muted">材料の内容を保ったテキスト・Excel・Wordを作成します。内容の正しさや、未指定の作業の完了を保証する機能ではありません。</p>
  {!state.criteria.length?<p role="status">現在のGoalに完了条件がありません。先に仕事の完了条件を登録してください。</p>:null}
  {state.materials?<div><p>このGoalの材料は登録済みです。変更せず再開できます。</p><ul>{state.materials.outputs.map(o=><li key={o.id}>{o.id}（{o.format}） <button className="button secondary" disabled={disabled||busy||state.busy} onClick={()=>void download(o.id)}>成果物を取得</button></li>)}</ul></div>:<>
   <label>材料を選ぶ（UTF-8、1件64KiBまで）<input type="file" style={{maxWidth:"100%"}} multiple accept=".txt,.md,.csv,.json" disabled={disabled||busy||!state.goalId||!state.criteria.length} onChange={e=>void selectFiles(e.target.files)}/></label>
   <p className="muted">Excel用JSON: cells配列にsheet・cell・value。Word用JSON: titleとsections。通常のExcel・Word・PDFファイルの読込は未対応です。</p>
   {drafts.map((draft,i)=><fieldset key={i} className="jarvis-task-form" style={{gridTemplateColumns:"minmax(0,1fr)",minWidth:0}} disabled={disabled||busy}><legend>{draft.name}</legend>
    <label style={{display:"grid",gap:6,minWidth:0}}>作成形式<select style={{width:"100%"}} value={draft.format} onChange={e=>{setAck(false);setDrafts(xs=>xs.map((x,j)=>j===i?{...x,format:e.target.value as Draft["format"]}:x));}}><option value="text">内容を保ったテキスト</option><option value="workbook-json">構造化JSONからExcel</option><option value="document-json">構造化JSONからWord</option></select></label>
    <p>この成果物で確認する完了条件</p>{state.criteria.map(c=><label key={c.id} style={{display:"block"}}><input type="checkbox" checked={draft.criteria.includes(c.id)} onChange={e=>{setAck(false);setDrafts(xs=>xs.map((x,j)=>j!==i?x:{...x,criteria:e.target.checked?[...x.criteria,c.id]:x.criteria.filter(id=>id!==c.id)}));}}/>{c.description}</label>)}
   </fieldset>)}
   {drafts.length>0&&<label style={{display:"block"}}><input type="checkbox" checked={ack} disabled={busy||disabled} onChange={e=>setAck(e.target.checked)}/>選んだ完了条件は、材料を保持したこの成果物の作成・検証で確認できます。</label>}
   <button className="button secondary" disabled={disabled||busy||state.busy||!ack||!drafts.length||drafts.some(d=>!d.criteria.length)} onClick={()=>void submit()}>材料と完了条件を登録</button>
  </>}
  <p role="status" aria-live="polite">{message}</p>
 </section>;
}
