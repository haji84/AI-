"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompletionCycle } from '../../../orchestrator/completion-path';

type WorkRun = {
  runId: string;
  goalId: string;
  phase: string;
  currentWork: string | null;
  completedJobs: number;
  totalJobs: number | null;
  recoveryCount: number;
  blockers: string[];
  nextAction: string | null;
  evidenceRefs: string[];
  updatedAt: string;
};
type WorkResponse = { run?: WorkRun; completion?: CompletionCycle | null; progress?: { determinate: boolean; value: number | null }; message?: string };

export function CompletionDetails({ completion }: { completion: CompletionCycle }) {
  const labels = { PREPARED: '未読', DELIVERED: '表示済み・回答待ち', ANSWERED: '回答記録あり' };
  return <div aria-label="完成条件と必要な対応">
    <h3>完成条件</h3>
    <p>{completion.readyForCompletionReview ? '完成判定の確認へ' : '未完了'}：検証済み {completion.verifiedCriteria.length} / 残り {completion.remainingCriteria.length}</p>
    {completion.replanRequired && <p role="status">進捗・証拠に基づく再計画が必要です。</p>}
    {completion.recommendation && <p>次の候補：{completion.recommendation.taskId}<br />根拠：{completion.recommendation.reasons.join(' / ')}</p>}
    {completion.notifications.length > 0 && <h3>あなたに必要な対応</h3>}
    {completion.notifications.map(n => <article key={n.id} className="panel" data-notification-id={n.id}>
      <strong>{n.operation}</strong><span className="count-badge neutral">{labels[n.status]}</span>
      <dl><dt>理由</dt><dd>{n.reason}</dd><dt>対象</dt><dd>{n.target}</dd><dt>期限</dt><dd>{n.deadline ?? '期限未指定'}</dd><dt>進行への影響</dt><dd>{n.impact}</dd></dl>
      {n.response && <p>回答：{n.response.status}（{n.response.at}）</p>}
    </article>)}
    {completion.notifications.length > 0 && <p className="muted">表示・回答の記録は実行許可にはなりません。必要な承認は既存のHuman Gateで確認します。</p>}
  </div>;
}

export default function GoalBridgeStatus() {
  const [goalId, setGoalId] = useState("");
  const [result, setResult] = useState<WorkResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  const panel = useRef<HTMLElement>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (value: string) => {
    const id = value.trim();
    if (!id) return;
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/jarvis/work/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json() as WorkResponse;
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      if (sequence === requestSequence.current) setResult(body);
    } catch (cause) {
      if (sequence === requestSequence.current) { setResult(null); setError(cause instanceof Error ? cause.message : "Goal状態を取得できません"); }
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    try { const id = window.localStorage.getItem('goriq-last-goal-id'); if (id) { setGoalId(id); void refresh(id); } } catch { /* Manual selection remains available. */ }
  }, [refresh]);
  const selectedGoal = result?.run?.goalId;
  useEffect(() => {
    if (!selectedGoal) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(selectedGoal); }, 10_000);
    return () => window.clearInterval(timer);
  }, [selectedGoal, refresh]);
  useEffect(() => {
    const completion = result?.completion;
    if (!selectedGoal || !completion || !panel.current) return;
    const pending = new Set(completion.notifications.filter(n => !n.delivery).map(n => n.id));
    if (!pending.size) return;
    const observer = new IntersectionObserver(entries => {
      if (document.visibilityState !== 'visible') return;
      const ids = entries.filter(e => e.isIntersecting).map(e => (e.target as HTMLElement).dataset.notificationId!).filter(id => pending.has(id));
      if (!ids.length) return;
      ids.forEach(id => pending.delete(id));
      void fetch(`/api/jarvis/work/${encodeURIComponent(selectedGoal)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cycleId: completion.cycleId, notificationIds: ids.slice(0, 64) }) })
        .then(async response => { if (!response.ok) throw Error('通知の表示記録を保存できませんでした'); setReceiptError(''); })
        .catch(() => setReceiptError('通知の表示記録を保存できませんでした。次の状態確認で再試行します。'));
    });
    panel.current.querySelectorAll('[data-notification-id]').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [selectedGoal, result?.completion]);

  const run = result?.run;
  return <section ref={panel} className="panel jarvis-section">
    <div className="section-heading">
      <div><p className="section-kicker">DIRECT GOAL BRIDGE</p><h2>ChatGPT / GORIQ Goal状態</h2></div>
      <span className="count-badge neutral">{run?.phase ?? "未選択"}</span>
    </div>
    <p className="muted">同じGoal IDで、外部入口から受けた仕事の実行状態・Recovery・Evidence・次の自律ActionをGORIQ側にも表示します。</p>
    <div className="jarvis-task-form">
      <label htmlFor="goriq-goal-id">Goal ID</label>
      <input id="goriq-goal-id" value={goalId} onChange={(event) => setGoalId(event.target.value)} placeholder="Goal ID" />
      <button className="button secondary" type="button" disabled={loading || !goalId.trim()} onClick={() => void refresh(goalId)}>{loading ? "確認中…" : "状態を表示"}</button>
    </div>
    {error && <p className="jarvis-alert" role="alert">{error}</p>}
    {receiptError && <p className="jarvis-alert" role="alert">{receiptError}</p>}
    {result?.completion && <CompletionDetails completion={result.completion} />}
    {run && <div className="jarvis-table-wrap"><table className="jarvis-table"><tbody>
      <tr><th>Goal</th><td>{run.goalId}</td></tr>
      <tr><th>状態</th><td>{run.phase}</td></tr>
      <tr><th>現在の作業</th><td>{run.currentWork ?? "-"}</td></tr>
      <tr><th>完了Job</th><td>{run.completedJobs}{run.totalJobs ? ` / ${run.totalJobs}` : ""}</td></tr>
      <tr><th>Recovery</th><td>{run.recoveryCount}</td></tr>
      <tr><th>Blocker / Gate</th><td>{run.blockers.length ? run.blockers.join(" / ") : "なし"}</td></tr>
      <tr><th>次の自律Action</th><td>{run.nextAction ?? "-"}</td></tr>
      <tr><th>Evidence</th><td>{run.evidenceRefs.length ? run.evidenceRefs.join(" / ") : "-"}</td></tr>
      <tr><th>最終更新</th><td>{run.updatedAt}</td></tr>
    </tbody></table></div>}
  </section>;
}
