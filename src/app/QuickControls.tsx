"use client";

import { useState } from "react";

type ControlAction = "run" | "resume" | "pause" | "status" | "test" | "preview";

const actions: Array<{ action: ControlAction; label: string; hint: string; tone?: string }> = [
  { action: "run", label: "作業を進める", hint: "次の安全な作業へ", tone: "primary" },
  { action: "pause", label: "一時停止", hint: "AI社員を停止" },
  { action: "resume", label: "再開", hint: "停止中の作業を再開" },
  { action: "status", label: "最新状態を確認", hint: "状態を再取得" },
  { action: "test", label: "テスト実行", hint: "安全な検証を実行" },
  { action: "preview", label: "Preview作成", hint: "本番ではなく確認版" },
];

export default function QuickControls({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState<ControlAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function execute(action: ControlAction) {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "操作に失敗しました");
      setMessage(body.message || "操作を受け付けました");
      if (action === "status") window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="quick-grid">
        {actions.map((item) => (
          <button
            className={`quick-button ${item.tone === "primary" ? "quick-primary" : ""}`}
            disabled={!enabled || busy !== null}
            key={item.action}
            onClick={() => execute(item.action)}
            type="button"
          >
            <strong>{busy === item.action ? "処理中…" : item.label}</strong>
            <span>{item.hint}</span>
          </button>
        ))}
      </div>
      {!enabled && <p className="inline-note">この端末をオーナー認証すると操作できます。</p>}
      {message && <p className="control-message" role="status">{message}</p>}
    </div>
  );
}
