"use client";

import { useCallback, useEffect, useState } from "react";

import type { JarvisRecoveryDashboardReport, JarvisRecoveryDashboardState } from "../../../jarvis/recovery-dashboard.ts";

const stateLabel: Record<JarvisRecoveryDashboardState, string> = {
  idle: "待機",
  recovering: "復旧中",
  waiting: "待機中",
  blocked: "ブロック",
  unknown: "未確認",
};

function fmt(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function JarvisRecoveryPage() {
  const [report, setReport] = useState<JarvisRecoveryDashboardReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/recovery", { cache: "no-store" });
      const body = await response.json() as JarvisRecoveryDashboardReport;
      if (typeof body.state !== "string" || typeof body.detail !== "string") throw new Error(`HTTP ${response.status}`);
      setReport(body);
      setError(response.ok || response.status === 401 ? "" : `HTTP ${response.status}`);
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : "Recovery statusを取得できません");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <main className="dashboard-shell">
      <div className="jarvis-console">
        <div className="jarvis-toolbar">
          <div>
            <p className="eyebrow">GORIQ RECOVERY DASHBOARD</p>
            <h1>Recovery Dashboard</h1>
            <p className="muted">永続化済みの復旧状態だけを表示します。ここから復旧操作は実行しません。</p>
          </div>
          <div className="jarvis-toolbar-actions">
            <button className="button secondary" disabled={loading} onClick={() => void refresh()}>再読込</button>
            <a className="button secondary" href="/jarvis">GORIQへ戻る</a>
          </div>
        </div>

        {error && <div className="jarvis-alert"><strong>Recovery status</strong><span>{error}</span></div>}

        <section className="panel jarvis-section">
          <div className="section-heading">
            <div><p className="section-kicker">STATUS</p><h2>現在の復旧状態</h2></div>
            <span className="count-badge neutral">{report ? stateLabel[report.state] : loading ? "確認中" : "未確認"}</span>
          </div>
          <div className="jarvis-table-wrap">
            <table className="jarvis-table">
              <tbody>
                <tr><th>Goal</th><td>{report?.goalTitle ?? "-"}</td></tr>
                <tr><th>Run</th><td>{report?.runId ?? "-"}</td></tr>
                <tr><th>Runtime state</th><td>{report?.runState ?? "-"}</td></tr>
                <tr><th>Recovery action</th><td>{report?.recoveryAction ?? "-"}</td></tr>
                <tr><th>Reason</th><td>{report?.reason ?? "-"}</td></tr>
                <tr><th>Blocker</th><td>{report?.blocker ?? "なし / 未確認"}</td></tr>
                <tr><th>Next action</th><td>{report?.nextAction ?? "-"}</td></tr>
                <tr><th>Observed</th><td>{fmt(report?.observedAt)}</td></tr>
                <tr><th>Evidence state</th><td>{report?.detail ?? (loading ? "確認中" : "未確認")}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <p className="jarvis-updated">最終更新 {fmt(report?.generatedAt)}</p>
      </div>
    </main>
  );
}
