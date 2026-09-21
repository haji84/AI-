"use client";\nimport "./work-shell.css";
import { useEffect, useState } from "react";
import { JARVIS_THEMES, jarvisTheme, type JarvisThemeId } from "./theme-catalog";

const STORAGE_KEY = "jarvis-ui-theme";

export default function JarvisWorkShell() {
  const [themeId, setThemeId] = useState<JarvisThemeId>("clean-modern");
  const [admin, setAdmin] = useState(false);
  const [command, setCommand] = useState("");
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    setThemeId(jarvisTheme(saved).id);
  }, []);
  const theme = jarvisTheme(themeId);
  function select(id: JarvisThemeId) {
    setThemeId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return <section className="jarvis-work-shell" data-theme={theme.id} data-mode={admin ? "admin" : "owner"} data-density={theme.density}>
    <header className="jarvis-work-header">
      <div><strong>JARVIS</strong><span>{admin ? "管理者モード" : "仕事を任せる"}</span></div>
      <button type="button" onClick={() => setAdmin((value) => !value)}>{admin ? "通常" : "管理者"}</button>
    </header>
    <nav aria-label="JARVIS navigation">
      {["ホーム","仕事","成果物","端末","検証","設定"].map((item) => <button type="button" key={item}>{item}</button>)}
    </nav>
    <main>
      <form className="jarvis-command" onSubmit={(event) => { event.preventDefault(); }}>
        <label htmlFor="jarvis-command-input">JARVISに何を任せますか？</label>
        <div><input id="jarvis-command-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="例：資料を調べてExcelにまとめて報告書を作って" /><button type="submit" disabled={!command.trim()}>任せる</button></div>
      </form>
      <div className="jarvis-summary-grid">
        <article><span>現在のゴール</span><strong>待機中</strong><small>仕事を入力するとここに進捗を表示します</small></article>
        <article><span>実行中</span><strong>0</strong><small>自動で更新</small></article>
        <article><span>確認が必要</span><strong>0</strong><small>Human Gateのみ表示</small></article>
        <article><span>完了</span><strong>0</strong><small>成果物をここから開く</small></article>
      </div>
      {admin && <section className="jarvis-admin-preview" aria-label="管理者情報">
        <h2>管理者</h2>
        <div className="jarvis-summary-grid">
          <article><span>Fact Verification</span><strong>0 / 0</strong><small>CONFIRMED / 要確認</small></article>
          <article><span>Recovery</span><strong>0</strong><small>strategy pivot / retry</small></article>
          <article><span>Evidence</span><strong>0</strong><small>詳細から追跡</small></article>
          <article><span>Fleet</span><strong>待機</strong><small>端末・Runner状態</small></article>
        </div>
      </section>}
      <details className="jarvis-theme-picker"><summary>外観を変更</summary><div className="jarvis-theme-grid">
        {JARVIS_THEMES.map((item) => <button type="button" key={item.id} aria-pressed={item.id === themeId} onClick={() => select(item.id)} data-preview={item.id}><span>{item.label}</span><small>{item.mode} / {item.density}</small></button>)}
      </div></details>
    </main>
  </section>;
}
