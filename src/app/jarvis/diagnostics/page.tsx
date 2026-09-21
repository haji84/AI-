"use client";

import { useCallback, useEffect, useState } from "react";

import {
  diagnosticStateLabel,
  type JarvisDiagnosticItem,
  type JarvisDiagnosticState,
} from "../../../jarvis/self-diagnostics.ts";

type DiagnosticsPayload = {
  generatedAt: string;
  overall: JarvisDiagnosticState;
  items: JarvisDiagnosticItem[];
};

function fmt(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function JarvisDiagnosticsPage() {
  const [report, setReport] = useState<DiagnosticsPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/diagnostics", { cache: "no-store" });
      const body = await response.json() as DiagnosticsPayload & { message?: string };
      if (!Array.isArray(body.items)) throw new Error(body.message || `HTTP ${response.status}`);
      setReport(body);
      setError(response.ok || response.status === 401 ? "" : body.message || `HTTP ${response.status}`);
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : "Self Diagnosticsを取得できません");
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
            <p className="eyebrow">JARVIS SELF DIAGNOSTICS</p>
            <h1>自己診断</h1>
            <p className="muted">確認できた証拠だけで原因を分けます。分からないものは「未確認」のままにします。</p>
          </div>
          <div className="jarvis-toolbar-actions">
            <button className="button secondary" disabled={loading} onClick={() => void refresh()}>再診断</button>
            <a className="button secondary" href="/jarvis">JARVISへ戻る</a>
          </div>
        </div>

        {error && <div className="jarvis-alert"><strong>診断取得</strong><span>{error}</span></div>}

        <section className="panel jarvis-section">
          <div className="section-heading">
            <div><p className="section-kicker">STATUS</p><h2>現在のブロッカー</h2></div>
            <span className="count-badge neutral">{report ? diagnosticStateLabel(report.overall) : loading ? "確認中" : "未確認"}</span>
          </div>
          <div className="jarvis-table-wrap">
            <table className="jarvis-table">
              <thead><tr><th>項目</th><th>状態</th><th>詳細</th><th>次の操作</th></tr></thead>
              <tbody>
                {(report?.items ?? []).map((entry) => (
                  <tr key={entry.code}>
                    <td><strong>{entry.label}</strong><small>{entry.code}</small></td>
                    <td>{diagnosticStateLabel(entry.state)}</td>
                    <td>{entry.detail}</td>
                    <td>{entry.action ?? "-"}</td>
                  </tr>
                ))}
                {!loading && (report?.items.length ?? 0) === 0 && <tr><td colSpan={4} className="jarvis-empty">診断結果を取得できません。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <p className="jarvis-updated">最終診断 {fmt(report?.generatedAt)}</p>
      </div>
    </main>
  );
}
