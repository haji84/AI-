"use client";

import { useState, type CSSProperties } from "react";
import { ConceptArtwork } from "./PersonalHero";
import { usePersonalUi } from "./PersonalizationProvider";
import { VISUAL_CONCEPTS, visualConceptStyle } from "./visual-concepts";
import { activePersonalUiProfile, addPersonalUiProfile, defaultPersonalUiState, setActivePersonalUiProfile, updatePersonalUiProfile, type PersonalNavPosition } from "./personalization-store";

const NAV_LABELS: Record<string, string> = { home: "ホーム", devices: "デバイス", tasks: "タスク", research: "リサーチ", settings: "設定" };
export default function PersonalAppearance() {
  const ui = usePersonalUi();
  const [name, setName] = useState("");
  function patch(value: Parameters<typeof updatePersonalUiProfile>[2]) {
    return ui.change(current => updatePersonalUiProfile(current, current.activeProfileId, value));
  }
  function add() {
    const result = addPersonalUiProfile(ui.state, name.trim() || "新しいGORIQ");
    if (result.error) { ui.report(result.error); return; }
    ui.change(result.state);
    setName("");
  }
  function moveNav(index: number, delta: number) {
    const next = [...ui.profile.navOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ navOrder: next });
  }
  return <section className="personal-studio" aria-labelledby="personal-studio-title" aria-busy={!ui.ready}>
    <header><p className="eyebrow">YOUR GORIQ</p><h2 id="personal-studio-title">あなたのGORIQをつくる</h2><p>20のデザインから選び、ホームとメニューを自分の使いやすい配置に。</p></header>
    {ui.error && <p role="alert" className="jarvis-alert">{ui.error}</p>}
    <fieldset disabled={!ui.ready}>
      <legend>自分用の表示プロフィール</legend>
      <div className="personal-profile-row">
        <label>使用中<select value={ui.state.activeProfileId} onChange={event => ui.change(setActivePersonalUiProfile(ui.state, event.target.value))}>
          {ui.state.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select></label>
        <label>新しいプロフィール名<input maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="例：自分用・仕事用" /></label>
        <button type="button" className="button" onClick={add}>プロフィールを追加</button>
      </div>
      <p className="personal-help">このブラウザーに保存されます。ログインアカウントとは別の表示設定です。</p>
    </fieldset>
    <div className="personal-section-title"><h3>20のデザイン</h3><button type="button" className="button secondary" aria-pressed={ui.legacy} onClick={() => ui.setLegacy(!ui.legacy)}>{ui.legacy ? "新しいデザインを使う" : "従来の外観を使う"}</button></div>
    <p className="personal-help">背景・装飾のデザインです。ペルソナ、音声、機能や端末権限は変わりません。</p>
    <div className="personal-concept-grid">
      {VISUAL_CONCEPTS.map((concept, index) => <button key={concept.id} type="button" className="personal-concept-card"
        disabled={!ui.ready} aria-pressed={!ui.legacy && ui.profile.conceptId === concept.id}
        aria-label={`${index + 1}. ${concept.label}を使う`} style={visualConceptStyle(concept) as CSSProperties}
        onClick={() => { if (patch({ conceptId: concept.id })) ui.setLegacy(false); }}>
        <ConceptArtwork concept={concept} className="personal-concept-art" />
        <span className="personal-concept-copy"><span className="personal-concept-number">{String(index + 1).padStart(2,"0")}</span><strong className="personal-concept-label">{concept.label}</strong><span className="personal-concept-description">{concept.description}</span></span>
      </button>)}
    </div>
    <fieldset disabled={!ui.ready}>
      <legend>メニューの配置</legend>
      <label>置く場所<select value={ui.profile.navPosition} onChange={event => patch({ navPosition: event.target.value as PersonalNavPosition })}>
        <option value="left">左側</option><option value="right">右側</option><option value="top">上側</option><option value="bottom">下側</option>
      </select></label>
      <p className="personal-help">スマホでは左右メニューを下部へまとめます。順番はそのまま引き継ぎます。</p>
      <ol className="personal-menu-editor">{ui.profile.navOrder.map((id,index) => <li key={id}><span>{NAV_LABELS[id]}</span>
        <button type="button" disabled={index === 0} aria-label={`${NAV_LABELS[id]}を前へ`} onClick={() => moveNav(index,-1)}>↑</button>
        <button type="button" disabled={index === 4} aria-label={`${NAV_LABELS[id]}を後へ`} onClick={() => moveNav(index,1)}>↓</button>
      </li>)}</ol>
      <div className="personal-toolbar"><button type="button" onClick={ui.undo} disabled={!ui.canUndo}>元に戻す</button><button type="button" onClick={ui.redo} disabled={!ui.canRedo}>やり直す</button>
        <button type="button" onClick={() => { const base = activePersonalUiProfile(defaultPersonalUiState()); patch({ navOrder: base.navOrder, navPosition: base.navPosition, panels: base.panels }); }}>このプロフィールの配置を初期化</button>
        <a className="button" href="/jarvis">ホームの配置を編集する</a>
      </div>
    </fieldset>
  </section>;
}
