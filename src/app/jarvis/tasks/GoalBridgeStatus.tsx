"use client";

import { useCallback, useState } from "react";

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
type WorkResponse = { run?: WorkRun; progress?: { determinate: boolean; value: number | null }; message?: string };

export default function GoalBridgeStatus() {
  const [goalId, setGoalId] = useState("");
  const [result, setResult] = useState<WorkResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const id = goalId.trim();
    if (!id) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/jarvis/work/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json() as WorkResponse;
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setResult(body);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Goal状態を取得できません");
    } finally { setLoading(false); }
  }, [goalId]);

  const run = result?.run;
  return <section className="panel jarvis-section">
    <div className="section-heading">
      <div><p className="section-kicker">DIRECT GOAL BRIDGE</p><h2>ChatGPT / GORIQ Goal状態</h2></div>
      <span className="count-badge neutral">{run?.phase ?? "未選択"}</span>
    </div>
    <p className="muted">同じGoal IDで、外部入口から受けた仕事の実行状態・Recovery・Evidence・次の自律ActionをGORIQ側にも表示します。</p>
    <div className="jarvis-task-form">
      <label htmlFor="goriq-goal-id">Goal ID</label>
      <input id="goriq-goal-id" value={goalId} onChange={(event) => setGoalId(event.target.value)} placeholder="Goal ID" />
      <button className="button secondary" type="button" disabled={loading || !goalId.trim()} onClick={() => void refresh()}>{loading ? "確認中…" : "状態を表示"}</button>
    </div>
    {error && <p className="jarvis-alert" role="alert">{error}</p>}
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
