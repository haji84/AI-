"use client";

import { useEffect, useMemo, useState } from "react";

import { buildJarvisFirstRunSetup } from "../../../jarvis/first-run-setup.ts";
import type { JarvisSelfDiagnosticReport } from "../../../jarvis/self-diagnostics.ts";

type DiagnosticsResponse = JarvisSelfDiagnosticReport & { generatedAt?: string };

const stateLabel = {
  ready: "準備完了",
  blocked: "要対応",
  pending: "確認待ち",
  unknown: "未確認",
} as const;

export default function JarvisSetupPage() {
  const [report, setReport] = useState<DiagnosticsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/jarvis/diagnostics", { cache: "no-store" });
      const body = await response.json() as DiagnosticsResponse & { message?: string };
      if (!response.ok) {
        throw new Error(response.status === 401 ? "オーナー認証が必要です" : body.message || "セットアップ状態を確認できませんでした");
      }
      setReport(body);
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : "セットアップ状態を確認できませんでした");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const setup = useMemo(() => report ? buildJarvisFirstRunSetup(report) : null, [report]);

  return (
    <main className="dashboard-shell">
      <div className="jarvis-toolbar">
        <div>
          <p className="eyebrow">JARVIS FIRST RUN</p>
          <h1>初回セットアップ</h1>
          <p className="muted">Host・Connection・Permissionを1画面で確認します。この画面は読み取り専用で、設定や権限を自動変更しません。</p>
        </div>
        <div className="jarvis-button-row">
          <button className="button secondary" type="button" disabled={loading} onClick={() => void refresh()}>{loading ? "確認中..." : "再確認"}</button>
          <a className="button secondary" href="/jarvis">JARVISへ戻る</a>
        </div>
      </div>

      {error && (
        <section className="panel jarvis-section" style={{ maxWidth: 900, margin: "24px auto" }}>
          <div className="jarvis-alert">
            <strong>状態を確認できません</strong>
            <span>{error}</span>
            <a className="button secondary" href="/jarvis/login?next=/jarvis/setup">オーナー認証へ</a>
          </div>
        </section>
      )}

      {!error && setup && (
        <section className="panel jarvis-section" style={{ maxWidth: 900, margin: "24px auto" }}>
          <div className="section-heading">
            <div>
              <p className="section-kicker">READ-ONLY READINESS</p>
              <h2>ソフトウェア準備状況</h2>
            </div>
            <strong>{stateLabel[setup.overall]}</strong>
          </div>
          <p className="muted">未確認・確認待ち・要対応が残っている場合は完了扱いにしません。BIOS/UEFIなど実機確認が必要な項目やHuman Gateは、この3ステップの完了判定へ混ぜていません。</p>
          {report?.generatedAt && <p className="muted">確認時刻: {new Date(report.generatedAt).toLocaleString("ja-JP")}</p>}

          <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
            {setup.steps.map((step, index) => (
              <article key={step.id} className="jarvis-alert">
                <strong>{index + 1}. {step.label} · {stateLabel[step.state]}</strong>
                <span>{step.detail}</span>
                <a className="button secondary" href={step.actionHref}>{step.actionLabel}</a>
              </article>
            ))}
          </div>

          <div className="jarvis-alert" style={{ marginTop: 20 }}>
            <strong>{setup.overall === "ready" ? "ソフトウェア側の初回準備は確認済み" : "未完了の項目があります"}</strong>
            <span>この表示は実機受入、独立監査、または外部環境の確認を代替しません。</span>
          </div>
        </section>
      )}
    </main>
  );
}
