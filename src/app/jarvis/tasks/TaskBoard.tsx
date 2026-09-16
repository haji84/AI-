"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TaskItem = {
  id: string;
  type: string;
  status: string;
  targetNodeId?: string;
  assignedNodeId?: string;
  attempts: number;
  maxAttempts: number;
  updatedAt: string;
};

type StatePayload = {
  generatedAt: string;
  tasks: TaskItem[];
  stats: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    needsHuman: number;
  };
  message?: string;
};

function fmt(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function TaskBoard() {
  const [state, setState] = useState<StatePayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/jarvis/state", { cache: "no-store" });
      const body = await response.json() as StatePayload;
      if (!response.ok) {
        if (response.status === 401) throw new Error("オーナー認証が必要です。認証後にタスク状態を再読み込みしてください。");
        throw new Error(body.message || `タスク状態を取得できません (HTTP ${response.status})`);
      }
      setState(body);
      setError("");
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error ? cause.message : "タスク状態を取得できません");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const tasks = useMemo(
    () => state?.tasks.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50) ?? [],
    [state],
  );

  return (
    <main className="jarvis-screen-page">
      <div className="jarvis-screen-heading">
        <div>
          <p className="eyebrow">TASK CONTROL</p>
          <h1>タスク</h1>
          <p className="muted">Queue、実行中、完了、失敗、Human Gate待ちを同じ画面で確認する。</p>
        </div>
        <button className="button secondary" type="button" disabled={loading} onClick={() => void refresh()}>{loading ? "更新中" : "更新"}</button>
      </div>

      {error && (
        <div className="jarvis-alert">
          <strong>取得できません</strong>
          <span>{error}</span>
          <a className="button secondary" href="/jarvis/login?next=/jarvis/tasks">オーナー認証</a>
        </div>
      )}

      <section className="jarvis-stats" aria-label="タスク集計">
        <article><span>Queue</span><strong>{state?.stats.queued ?? "-"}</strong></article>
        <article><span>実行中</span><strong>{state?.stats.running ?? "-"}</strong></article>
        <article><span>完了</span><strong>{state?.stats.completed ?? "-"}</strong></article>
        <article><span>失敗</span><strong>{state?.stats.failed ?? "-"}</strong></article>
        <article><span>Human Gate</span><strong>{state?.stats.needsHuman ?? "-"}</strong></article>
      </section>

      <section className="panel jarvis-section">
        <div className="jarvis-screen-heading compact">
          <div><h2>最新50件</h2><p className="muted">取得時刻: {state ? fmt(state.generatedAt) : "-"}</p></div>
        </div>
        <div className="jarvis-table-wrap">
          <table className="jarvis-table">
            <thead><tr><th>ID</th><th>種類</th><th>状態</th><th>端末</th><th>試行</th><th>更新</th></tr></thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr><td className="jarvis-empty" colSpan={6}>{loading ? "読み込み中…" : error ? "状態取得待ち" : "タスクはありません"}</td></tr>
              ) : tasks.map((task) => (
                <tr key={task.id}>
                  <td><strong>{task.id}</strong></td>
                  <td>{task.type}</td>
                  <td><span className={`jarvis-node-status ${task.status.toLowerCase().replaceAll("_", "-")}`}>{task.status}</span></td>
                  <td>{task.assignedNodeId ?? task.targetNodeId ?? "自動"}</td>
                  <td>{task.attempts}/{task.maxAttempts}</td>
                  <td>{fmt(task.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="jarvis-boundary-note">この画面は既存のオーナー保護された状態APIを読み取る。権限変更、認証回避、Human Gateの承認処理は行わない。</p>
    </main>
  );
}
