"use client";

import { useState } from "react";

const MANAGED_KEY = "AI_COMPANY_GITHUB_TOKEN";

export default function SecretOpsPanel({ enabled }: { enabled: boolean }) {
  const [approved, setApproved] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approveOnce() {
    if (!enabled || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/secret-ops/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_vercel_secret", key: MANAGED_KEY }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; expiresInSeconds?: number };
      if (!response.ok) throw new Error(body.message || "Secret操作の承認に失敗しました");
      setApproved(true);
      setMessage(`この1回だけ許可しました。承認は約${Math.round((body.expiresInSeconds ?? 300) / 60)}分で失効します。`);
    } catch (reason) {
      setApproved(false);
      setError(reason instanceof Error ? reason.message : "Secret操作の承認に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function rotateAndRedeploy() {
    if (!enabled || busy || !approved) return;
    if (!value.trim()) {
      setError("新しいSecret値を入力してください");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/vercel-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_secret",
          key: MANAGED_KEY,
          value,
          redeploy: true,
        }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; deployment?: { deploymentId?: string | null } };
      if (!response.ok) throw new Error(body.message || "Secret更新に失敗しました");
      setValue("");
      setApproved(false);
      setMessage(body.deployment?.deploymentId
        ? "Secretを更新し、Production再デプロイを開始しました。承認は自動失効しました。"
        : "Secretを更新しました。承認は自動失効しました。");
    } catch (reason) {
      // Approval is consumed before the external mutation, including failure paths.
      setApproved(false);
      setValue("");
      setError(`${reason instanceof Error ? reason.message : "Secret更新に失敗しました"}。再試行にはもう一度承認してください。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="secret-ops-panel">
      <p className="inline-note">GitHub PATなどのSecret操作は通常ロックされています。オーナーがこの1回だけ許可した時だけ実行できます。</p>
      {!approved ? (
        <button className="button secondary" type="button" disabled={!enabled || busy} onClick={() => void approveOnce()}>
          {busy ? "承認中…" : "この1回だけSecret更新を許可"}
        </button>
      ) : (
        <div className="decision-actions">
          <input
            aria-label="新しいGitHub PAT"
            autoComplete="off"
            placeholder="新しいGitHub PATをここに入力"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button className="button" type="button" disabled={busy || !value.trim()} onClick={() => void rotateAndRedeploy()}>
            {busy ? "更新中…" : "更新してProduction再デプロイ"}
          </button>
        </div>
      )}
      {message && <p className="inline-note">✓ {message}</p>}
      {error && <p className="inline-note text-alert">{error}</p>}
      <p className="inline-note">Secret値はGitHub・画面レスポンス・監査ログへ保存しません。</p>
    </div>
  );
}
