"use client";
import { useEffect, useState, type ReactNode } from "react";
import GoriqIcon from "./GoriqIcon";
import { usePersonalUi } from "./PersonalizationProvider";
import { addPersonalUiPanel, defaultPersonalUiState, activePersonalUiProfile, movePersonalUiPanel, removePersonalUiPanel, updatePersonalUiProfile, PERSONAL_PANEL_KINDS, type PersonalPanelKind, type PersonalPanelWidth } from "./personalization-store";
export const PANEL_LABELS: Record<PersonalPanelKind,string> = { command:"依頼する", goal:"現在の依頼", summary:"端末・タスクの状況", requirements:"仕様・要望", clock:"時計", note:"メモ", shortcuts:"ショートカット" };
function Clock() {
  const [now,setNow] = useState<Date|null>(null);
  useEffect(() => { setNow(new Date()); const timer = setInterval(() => setNow(new Date()),1000); return () => clearInterval(timer); },[]);
  return <div className="personal-clock"><span>いまの時間</span><strong>{now ? new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(now) : "--:--:--"}</strong><span>{now?.toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"}) ?? "読み込み中"}</span></div>;
}
export default function PersonalDashboard({ contents }: { contents: Partial<Record<PersonalPanelKind,ReactNode>> }) {
  const ui = usePersonalUi();
  const [editing,setEditing] = useState(false);
  const [adding,setAdding] = useState<PersonalPanelKind>("clock");
  function move(id:string, index:number) { ui.change(current => movePersonalUiPanel(current,current.activeProfileId,id,index)); }
  function patchPanels(panels: typeof ui.profile.panels) { ui.change(current => updatePersonalUiProfile(current,current.activeProfileId,{panels})); }
  const available = PERSONAL_PANEL_KINDS.filter(kind => !ui.profile.panels.some(panel => panel.kind === kind));
  const selected = available.includes(adding) ? adding : available[0];
  const extra: Partial<Record<PersonalPanelKind,ReactNode>> = {
    clock: <Clock />,
    note: <label className="personal-note">自分用メモ<textarea maxLength={2000} value={ui.profile.note} onChange={event => ui.change(current => updatePersonalUiProfile(current,current.activeProfileId,{note:event.target.value}))} placeholder="ここに自分用のメモを書けます" /><small>この表示プロフィールに保存</small></label>,
    shortcuts: <nav className="personal-shortcuts" aria-label="ホームのショートカット"><a href="/jarvis/devices">端末を操作する ↗</a><a href="/jarvis/enroll">端末を追加する ↗</a><a href="/jarvis/teach">操作を教える ↗</a><a href="/jarvis/tasks">タスクを見る ↗</a><a href="/jarvis/recovery">復旧状況 ↗</a></nav>,
  };
  return <div className="personal-dashboard">
    <div className="personal-toolbar"><span className="goriq-profile-badge"><span className="goriq-profile-dot" />{ui.profile.name}</span><button type="button" disabled={!ui.ready} aria-pressed={editing} onClick={() => setEditing(!editing)}><GoriqIcon name="grid" />{editing ? "編集を終える" : "配置を編集"}</button><a href="/jarvis/settings#appearance"><GoriqIcon name="palette" />外観を選ぶ</a></div>
    {ui.error && <p role="alert" className="jarvis-alert">{ui.error}</p>}
    {editing && <div className="personal-edit-toolbar"><p>ドラッグ、または矢印で移動できます。変更はこのプロフィールに保存されます。</p>
      <div className="personal-toolbar"><label>追加する表示<select value={selected ?? ""} disabled={!available.length} onChange={event => setAdding(event.target.value as PersonalPanelKind)}>{available.length ? available.map(kind => <option key={kind} value={kind}>{PANEL_LABELS[kind]}</option>) : <option value="">すべて追加済み</option>}</select></label><button type="button" disabled={!selected} onClick={() => { if (!selected) return; const result=addPersonalUiPanel(ui.state,ui.state.activeProfileId,selected); if(result.error)ui.report(result.error);else ui.change(result.state); }}>表示を追加</button>
      <button type="button" disabled={!ui.canUndo} onClick={ui.undo}>元に戻す</button><button type="button" disabled={!ui.canRedo} onClick={ui.redo}>やり直す</button><button type="button" onClick={() => patchPanels(activePersonalUiProfile(defaultPersonalUiState()).panels)}>ホームを初期配置へ</button></div>
    </div>}
    <div className="personal-panel-grid" data-editing={editing}>
      {ui.profile.panels.map((panel,index) => <section key={panel.id} className="personal-panel" data-panel-kind={panel.kind} data-width={panel.width} aria-label={PANEL_LABELS[panel.kind]}
        draggable={editing} onDragStart={event => { event.dataTransfer.setData("application/x-jarvis-personal-panel",panel.id); event.dataTransfer.effectAllowed="move"; }}
        onDragOver={event => { if(editing)event.preventDefault(); }} onDrop={event => { if(!editing)return; event.preventDefault(); const id=event.dataTransfer.getData("application/x-jarvis-personal-panel"); if(ui.profile.panels.some(item=>item.id===id))move(id,index); }}>
        {editing && <div className="personal-panel-tools"><strong>{PANEL_LABELS[panel.kind]}</strong>
          <button type="button" aria-label={`${PANEL_LABELS[panel.kind]}を前へ`} disabled={index===0} onClick={()=>move(panel.id,index-1)}>↑</button><button type="button" aria-label={`${PANEL_LABELS[panel.kind]}を後へ`} disabled={index===ui.profile.panels.length-1} onClick={()=>move(panel.id,index+1)}>↓</button>
          <label><span className="sr-only">{PANEL_LABELS[panel.kind]}の幅</span><select value={panel.width} onChange={event=>patchPanels(ui.profile.panels.map(item=>item.id===panel.id?{...item,width:event.target.value as PersonalPanelWidth}:item))}><option value="normal">標準幅</option><option value="wide">広め</option><option value="full">全幅</option></select></label>
          <button type="button" aria-label={`${PANEL_LABELS[panel.kind]}を非表示`} onClick={()=>ui.change(current=>removePersonalUiPanel(current,current.activeProfileId,panel.id))}>非表示</button>
        </div>}
        {contents[panel.kind] ?? extra[panel.kind]}
      </section>)}
    </div>
    {!ui.profile.panels.length && <p>表示パーツがありません。「配置を編集」から追加できます。</p>}
  </div>;
}
