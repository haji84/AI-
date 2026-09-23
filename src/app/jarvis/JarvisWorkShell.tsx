"use client";
import "./work-shell.css";
import GoriqIcon from "./GoriqIcon";
import { addPersonalUiPanel } from "./personalization-store";
import PersonalDashboard from "./PersonalDashboard";
import PersonalHero from "./PersonalHero";
import PersonalLiveSummary from "./PersonalLiveSummary";
import { usePersonalUi } from "./PersonalizationProvider";
import RequirementsPanel from "./tasks/RequirementsPanel";
import { useEffect, useRef, useState } from "react";
import { JARVIS_THEMES, jarvisTheme, type JarvisThemeId } from "./theme-catalog";

const STORAGE_KEY = "jarvis-ui-theme";

export default function JarvisWorkShell() {
  const personal = usePersonalUi();
  const commandInput = useRef<HTMLInputElement>(null);
  const [focusRequested, setFocusRequested] = useState(false);
  useEffect(() => {
    if (!focusRequested || !commandInput.current) return;
    commandInput.current.focus();
    commandInput.current.scrollIntoView({ block: "center" });
    setFocusRequested(false);
  }, [focusRequested, personal.profile.panels]);
  function openComposer() {
    if (!personal.profile.panels.some(panel => panel.kind === "command")) {
      const added = addPersonalUiPanel(personal.state, personal.state.activeProfileId, "command");
      if (added.error) { personal.report(added.error); return; }
      if (!personal.change(added.state)) return;
    }
    setFocusRequested(true);
  }
  const reportPreferenceError = personal.report;
  const pendingCommand = useRef<{text:string;key:string}|null>(null);
  const [themeId, setThemeId] = useState<JarvisThemeId>("clean-modern");
  const [admin, setAdmin] = useState(false);
  const [command, setCommand] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [workStatus, setWorkStatus] = useState<{ goalId?: string | null; action?: string; nextAction?: string | null; error?: string } | null>(null);
  const [runStatus, setRunStatus] = useState<{ phase?: string; currentWork?: string | null; completedJobs?: number; totalJobs?: number | null; recoveryCount?: number; blockers?: string[]; progress?: { determinate: boolean; value: number | null } } | null>(null);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      setThemeId(jarvisTheme(saved).id);
    } catch { reportPreferenceError("従来のホーム設定を読み込めません。初期表示を使用します。"); }
  }, [reportPreferenceError]);
  const theme = jarvisTheme(themeId);
  useEffect(() => {
    const goalId = workStatus?.goalId;
    if (!goalId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jarvis/work/${encodeURIComponent(goalId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { run?: Record<string, unknown>; progress?: { determinate: boolean; value: number | null } };
        if (!cancelled && body.run) setRunStatus({ ...(body.run as object), progress: body.progress });
      } catch { /* status polling is best effort; command state remains visible */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [workStatus?.goalId]);
  function select(id: JarvisThemeId) {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
      setThemeId(id);
      personal.setLegacy(true);
    } catch { reportPreferenceError("従来のホーム設定を保存できませんでした。"); }
  }
  async function submitCommand() {
    const text = command.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setWorkStatus(null);
    if(pendingCommand.current?.text!==text)pendingCommand.current={text,key:crypto.randomUUID()};
    try {
      const response = await fetch("/api/jarvis/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, idempotencyKey:pendingCommand.current.key }) });
      const body = await response.json() as { goalId?: string | null; action?: string; nextAction?: string | null; message?: string; conversation?: {needsClarification:boolean;message:string} };
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      pendingCommand.current=null;
      if(body.conversation?.needsClarification){setWorkStatus({error:body.conversation.message+" 下の仕様・要望で参照先を選択できます。"});return;}
      setWorkStatus({ goalId: body.goalId, action: body.action, nextAction: body.nextAction });
      setCommand("");
    } catch (error) {
      setWorkStatus({ error: error instanceof Error ? error.message : "Goal受付に失敗しました" });
    } finally { setSubmitting(false); }
  }
  return <section className="jarvis-work-shell" data-theme={theme.id} data-mode={admin ? "admin" : "owner"} data-density={theme.density}>
    <PersonalHero />
    <section className="goriq-action-section" aria-label="すぐに始める"><div className="goriq-section-heading"><div><span>QUICK START</span><h2>すぐに始める</h2></div><span>やりたいことから選ぶ</span></div>
      <div className="goriq-actions">
        <a className="goriq-action" data-primary="true" href="#remote-controls" onClick={() => {
          const console = document.getElementById("remote-controls");
          if (console instanceof HTMLDetailsElement) console.open = true;
        }}><span className="goriq-action-icon"><GoriqIcon name="devices" /></span><span><strong>端末を操作</strong><small>画面を見る・遠隔で操作する</small></span><GoriqIcon name="arrow" /></a>
        <button type="button" className="goriq-action" onClick={openComposer} disabled={!personal.ready}><span className="goriq-action-icon"><GoriqIcon name="send" /></span><span><strong>仕事を頼む</strong><small>やりたいことを言葉で伝える</small></span><GoriqIcon name="arrow" /></button>
        <a className="goriq-action" href="/jarvis/tasks"><span className="goriq-action-icon"><GoriqIcon name="tasks" /></span><span><strong>進み具合</strong><small>タスク・結果・確認待ちを見る</small></span><GoriqIcon name="arrow" /></a>
      </div>
    </section>
    <PersonalDashboard contents={{
      command: <form className="jarvis-command" onSubmit={(event) => { event.preventDefault(); void submitCommand(); }}>
        <label htmlFor="jarvis-command-input">GORIQに何を任せますか？</label>
        <div><input ref={commandInput} id="jarvis-command-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="例：資料を調べて報告書にまとめて" /><button className="jarvis-launch-core" type="submit" aria-label="GORIQへ送信" data-state={submitting ? "accepting" : runStatus?.phase === "COMPLETED" ? "completed" : runStatus?.phase === "BLOCKED" || runStatus?.phase === "FAILED" ? "blocked" : workStatus?.goalId ? "running" : command.trim() ? "ready" : "idle"} style={runStatus?.progress?.determinate && runStatus.progress.value !== null ? { "--jarvis-progress": Math.round(runStatus.progress.value * 360) + "deg" } as React.CSSProperties : undefined} disabled={!command.trim() || submitting}><span aria-hidden="true">›</span></button></div>
      </form>,
      goal: <div className="personal-goal"><p className="eyebrow">CURRENT REQUEST</p><h2>この画面からの依頼</h2>
        {workStatus ? <div className="jarvis-work-status" role="status">{workStatus.error ? "受付失敗: " + workStatus.error : runStatus ? (runStatus.phase ?? "実行中") + (runStatus.currentWork ? " · " + runStatus.currentWork : "") : "依頼を受け付けました"}</div> : <p>依頼すると、ここに進捗が表示されます。</p>}
        {runStatus?.progress?.determinate && runStatus.progress.value !== null && <progress max={1} value={runStatus.progress.value} aria-label="依頼の進捗" />}
        {workStatus?.nextAction && <p>次の作業：{workStatus.nextAction}</p>}
        <a href="/jarvis/tasks">保存されたタスクを見る →</a>
      </div>,
      summary: <PersonalLiveSummary />,
      requirements: <RequirementsPanel />,
    }} />
    <details className="jarvis-theme-picker"><summary>従来のホームテーマ・詳細表示</summary>
      <button type="button" onClick={() => setAdmin(value => !value)}>{admin ? "詳細を閉じる" : "詳細を見る"}</button>
      {admin && <div className="personal-shortcuts"><a href="/jarvis/diagnostics">自己診断</a><a href="/jarvis/recovery">復旧状況</a><a href="/jarvis/research">研究・証拠</a></div>}
      <div className="jarvis-theme-grid">{JARVIS_THEMES.map(item => <button type="button" key={item.id} aria-pressed={personal.legacy && item.id === themeId} onClick={() => select(item.id)} data-preview={item.id}><span>{item.label}</span><small>{item.mode} / {item.density}</small></button>)}</div>
    </details>
  </section>;
}
