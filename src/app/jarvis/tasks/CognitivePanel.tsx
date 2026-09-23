"use client";
import { useEffect, useState } from "react";
type Snapshot = { goalId: string | null; goalTitle: string | null; busy: boolean; goalComplete: boolean; mode: string; attempts: number; nextAction: string | null; blockers: string[]; externalAIEnabled: boolean; localActionsConfigured: boolean; metrics: { goals: number; completedGoals: number; externalAiFreeCompletionRate: number | null; externalAiCallsPerGoal: number | null } };
export default function CognitivePanel() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const r = await fetch("/api/jarvis/cognitive", { cache: "no-store" });
      const b = await r.json();
      if (!r.ok) throw Error(b.message || "認知状態を取得できません");
      setState(b); return true;
    } catch (e) { setMessage(e instanceof Error ? e.message : "認知状態を取得できません"); return false; }
  }
  useEffect(() => { let active = true; void fetch("/api/jarvis/cognitive", { cache: "no-store" }).then(async r => {
    const b = await r.json(); if (!active) return;
    if (r.ok) setState(b); else setMessage(b.message || "認知状態を取得できません");
  }).catch(() => { if (active) setMessage("認知状態を取得できません"); }); return () => { active = false; }; }, []);
  async function continueGoal() {
    if (!state?.goalId || state.goalComplete || busy) return;
    setBusy(true); setMessage("ローカルの記憶・候補・検証結果を確認しています…");
    try {
      const r = await fetch("/api/jarvis/cognitive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goalId: state.goalId }) });
      const b = await r.json(); if (!r.ok) throw Error(b.message || "処理を開始できません");
      setMessage(b.stopReason === "goal_complete" ? "完了条件を検証しました" : b.stopReason === "approval_required" ? "この操作には承認が必要です" : "今回の処理を保存しました。次の作業と不足条件を確認できます。");
      await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "状態を確認してください。自動では再送しません。"); }
    finally { setBusy(false); }
  }
  const rate = state?.metrics.externalAiFreeCompletionRate;
  return <section className="panel jarvis-section" aria-label="GORIQ Cognitive Core">
    <div className="jarvis-screen-heading compact"><div><p className="eyebrow">COGNITIVE CORE</p><h2>考える・試す・学ぶ</h2>
      <p className="muted">{state?.goalTitle || "現在のGoalはありません"}</p></div>
      <button className="button secondary" disabled={busy} onClick={() => void refresh()}>状態を更新</button></div>
    <dl><dt>動作状態</dt><dd>{state?.goalComplete ? "完了条件を検証済み" : state?.mode === "DEGRADED" ? "利用できるローカル機能で継続" : state?.mode ?? "取得中"}</dd>
      <dt>外部AIなしの完了率</dt><dd>{rate === null || rate === undefined ? "未計測" : Math.round(rate * 100) + "%"}{state ? "（対象 " + state.metrics.goals + " Goal）" : ""}</dd>
      <dt>次の作業</dt><dd>{state?.nextAction ?? "受付待ち"}</dd></dl>
    {state?.blockers.length ? <p className="jarvis-alert">{state.blockers.join(" / ")}</p> : null}
    {state && !state.localActionsConfigured && <p className="muted">現在は状態確認が利用できます。ファイル処理には対象・成果物・検証条件を設定した作業が必要です。</p>}
    <button className="button" disabled={busy || state?.busy || state?.goalComplete || !state?.goalId} onClick={() => void continueGoal()}>{state?.goalComplete ? "このGoalは完了しました" : busy ? "処理中…" : "現在のGoalを続ける"}</button>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
