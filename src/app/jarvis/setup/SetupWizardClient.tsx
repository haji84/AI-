"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildJarvisFirstRunSetup } from "../../../jarvis/first-run-setup.ts";
import {
  diagnosticStateLabel,
  type JarvisDiagnosticItem,
} from "../../../jarvis/self-diagnostics.ts";

type DiagnosticsPayload = {
  generatedAt: string;
  items: JarvisDiagnosticItem[];
  message?: string;
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

export default function SetupWizardClient() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/jarvis/diagnostics", { cache: "no-store" });
      const body = await response.json() as DiagnosticsPayload;
      if (!response.ok || !Array.isArray(body.items)) throw new Error(body.message || `HTTP ${response.status}`);
      setDiagnostics(body);
      setError("");
    } catch (cause) {
      setDiagnostics(null);
      setError(cause instanceof Error ? cause.message : "セットアップ状態を取得できません");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setup = useMemo(
    () => buildJarvisFirstRunSetup(diagnostics?.items ?? []),
    [diagnostics],
  );

  return (
    <div className="jarvis-console">
      <div className="jarvis-toolbar">
        <div>
          <p className="eyebrow">GORIQ FIRST-RUN SETUP</p>
          <h1>初回セットアップ</h1>
          <p className="muted">ホスト、接続、権限を順番に確認します。この画面は案内専用で、設定を自動変更しません。</p>
        </div>
        <div className="jarvis-toolbar-actions">
          <button className="button secondary" disabled={loading} onClick={() => void refresh()}>再確認</button>
          <a className="button secondary" href="/jarvis/diagnostics">詳細診断</a>
          <a className="button secondary" href="/jarvis">GORIQへ戻る</a>
        </div>
      </div>

      {error && <div className="jarvis-alert"><strong>セットアップ状態</strong><span>{error}</span></div>}

      <section className="panel jarvis-section">
        <div className="section-heading">
          <div><p className="section-kicker">READINESS</p><h2>セットアップ手順</h2></div>
          <span className="count-badge neutral">{loading ? "確認中" : diagnosticStateLabel(setup.overall)}</span>
        </div>

        <div className="jarvis-table-wrap">
          <table className="jarvis-table">
            <thead><tr><th>手順</th><th>状態</th><th>確認内容</th><th>必要な対応</th></tr></thead>
            <tbody>
              {setup.steps.map((step) => (
                <tr key={step.id}>
                  <td><strong>{step.title}</strong></td>
                  <td>{loading ? "確認中" : diagnosticStateLabel(step.state)}</td>
                  <td>{loading ? "診断結果を確認しています" : step.detail}</td>
                  <td>{step.actions.length > 0 ? step.actions.join(" / ") : step.state === "ready" ? "対応不要" : "詳細診断で確認してください"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="jarvis-alert">
        <strong>安全境界</strong>
        <span>このウィザードは状態確認と案内だけを行います。端末登録、権限変更、ネットワーク設定、Human Gate操作は自動実行しません。</span>
      </div>

      <p className="jarvis-updated">最終確認 {fmt(diagnostics?.generatedAt)}</p>
    </div>
  );
}
