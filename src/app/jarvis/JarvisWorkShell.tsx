"use client";
import "./work-shell.css";
import RequirementsPanel from "./tasks/RequirementsPanel";
import { useEffect, useRef, useState } from "react";
import { JARVIS_THEMES, jarvisTheme, type JarvisThemeId } from "./theme-catalog";

const STORAGE_KEY = "jarvis-ui-theme";
const LAST_GOAL_KEY = "goriq-last-goal-id";

export default function JarvisWorkShell() {
  const pendingCommand = useRef<{text:string;key:string}|null>(null);
  const [themeId, setThemeId] = useState<JarvisThemeId>("clean-modern");
  const [admin, setAdmin] = useState(false);
  const [command, setCommand] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [workStatus, setWorkStatus] = useState<{ goalId?: string | null; action?: string; nextAction?: string | null; error?: string } | null>(null);
  const [runStatus, setRunStatus] = useState<{ phase?: string; currentWork?: string | null; completedJobs?: number; totalJobs?: number | null; recoveryCount?: number; blockers?: string[]; progress?: { determinate: boolean; value: number | null } } | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    setThemeId(jarvisTheme(saved).id);
    const lastGoalId = window.localStorage.getItem(LAST_GOAL_KEY)?.trim();
    if (lastGoalId) setWorkStatus({ goalId: lastGoalId });
  }, []);
  const theme = jarvisTheme(themeId);

  useEffect(() => {
    const goalId = workStatus?.goalId;
    if (!goalId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jarvis/work/${encodeURIComponent(goalId)}`, { cache: "no-store" });
        if (!response.ok) {
          if (response.status === 404) {
            window.localStorage.removeItem(LAST_GOAL_KEY);
            if (!cancelled) setWorkStatus(null);
          }
          return;
        }
        const body = await response.json() as { run?: Record<string, unknown>; progress?: { determinate: boolean; value: number | null } };
        if (!cancelled && body.run) setRunStatus({ ...(body.run as object), progress: body.progress });
      } catch { /* polling is best effort; durable Goal remains authoritative */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [workStatus?.goalId]);

  function select(id: JarvisThemeId) {
    setThemeId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }

  async function submitCommand() {
    const text = command.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setWorkStatus(null);
    if (pendingCommand.current?.text !== text) pendingCommand.current = { text, key: crypto.randomUUID() };
    try {
      const response = await fetch("/api/jarvis/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, idempotencyKey: pendingCommand.current.key }),
      });
      const body = await response.json() as { goalId?: string | null; action?: string; nextAction?: string | null; message?: string; conversation?: {needsClarification:boolean;message:string} };
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      pendingCommand.current = null;
      if (body.conversation?.needsClarification) {
        setWorkStatus({ error: body.conversation.message + " 下の仕様・要望で参照先を選択できます。" });
        return;
      }
      setWorkStatus({ goalId: body.goalId, action: body.action, nextAction: body.nextAction });
      if (body.goalId) window.localStorage.setItem(LAST_GOAL_KEY, body.goalId);
      setCommand("");
    } catch (error) {
      setWorkStatus({ error: error instanceof Error ? error.message : "Goal受付に失敗しました" });
    } finally {
      setSubmitting(false);
    }
  }

  const phase = runStatus?.phase ?? (workStatus?.goalId ? "受付済み" : "待機中");

  return <section className="jarvis-work-shell" data-theme={theme.id} data-mode={admin ? "admin" : "owner"} data-density={theme.density}>
    <header className="jarvis-work-header">
      <div><strong>GORIQ</strong><span>{admin ? "管理者情報を表示中" : "やりたいことを、そのまま入力"}</span></div>
      <button type="button" onClick={() => setAdmin((value) => !value)}>{admin ? "通常表示" : "詳細"}</button>
    </header>
    <main>
      <form className="jarvis-command" onSubmit={(event) => { event.preventDefault(); void submitCommand(); }}>
        <label htmlFor="jarvis-command-input">GORIQに何をしてほしい？</label>
        <div>
          <input id="jarvis-command-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="例：GitHubの続きを確認して、必要なら修正して" />
          <button className="jarvis-launch-core" type="submit" aria-label="GORIQへ送信" data-state={submitting ? "accepting" : runStatus?.phase === "COMPLETED" ? "completed" : runStatus?.phase === "BLOCKED" || runStatus?.phase === "FAILED" ? "blocked" : workStatus?.goalId ? "running" : command.trim() ? "ready" : "idle"} style={runStatus?.progress?.determinate && runStatus.progress.value !== null ? { "--jarvis-progress": `${Math.round(runStatus.progress.value * 360)}deg` } as React.CSSProperties : undefined} disabled={!command.trim() || submitting}><span aria-hidden="true">›</span></button>
        </div>
      </form>

      {workStatus && <div className="jarvis-work-status" role="status">
        {workStatus.error
          ? `受付失敗: ${workStatus.error}`
          : runStatus
            ? `${phase}${runStatus.currentWork ? ` · ${runStatus.currentWork}` : ""}${runStatus.progress?.determinate && runStatus.progress.value !== null ? ` · ${Math.round(runStatus.progress.value * 100)}%` : ""}`
            : `受付済み${workStatus.goalId ? ` · Goal ${workStatus.goalId}` : ""}${workStatus.nextAction ? ` · 次: ${workStatus.nextAction}` : ""}`}
      </div>}

      <div className="jarvis-summary-grid">
        <article><span>現在の作業</span><strong>{phase}</strong><small>{runStatus?.currentWork ?? (workStatus?.goalId ? "GORIQが処理を引き継ぎました" : "入力待ち")}</small></article>
        <article><span>進捗</span><strong>{runStatus?.progress?.determinate && runStatus.progress.value !== null ? `${Math.round(runStatus.progress.value * 100)}%` : "自動"}</strong><small>閉じてもGoalは継続</small></article>
        <article><span>確認が必要</span><strong>{runStatus?.phase === "HUMAN_GATE" ? "あり" : "なし"}</strong><small>必要なときだけ表示</small></article>
        <article><span>復旧</span><strong>{runStatus?.recoveryCount ?? 0}</strong><small>自動再試行・再計画</small></article>
      </div>

      {admin && <section className="jarvis-admin-preview" aria-label="管理者情報">
        <h2>詳細</h2>
        <div className="jarvis-summary-grid">
          <article><span>Goal ID</span><strong>{workStatus?.goalId ?? "-"}</strong><small>Durable State</small></article>
          <article><span>Action</span><strong>{workStatus?.action ?? "-"}</strong><small>内部ルーティング</small></article>
          <article><span>Blocker</span><strong>{runStatus?.blockers?.length ?? 0}</strong><small>{runStatus?.blockers?.join(" / ") || "なし"}</small></article>
          <article><span>Runtime</span><strong>自動</strong><small>端末・Local・外部を内部で選択</small></article>
        </div>
        <RequirementsPanel />
        <details className="jarvis-theme-picker"><summary>外観を変更</summary><div className="jarvis-theme-grid">
          {JARVIS_THEMES.map((item) => <button type="button" key={item.id} aria-pressed={item.id === themeId} onClick={() => select(item.id)} data-preview={item.id}><span>{item.label}</span><small>{item.mode} / {item.density}</small></button>)}
        </div></details>
      </section>}
    </main>
  </section>;
}
