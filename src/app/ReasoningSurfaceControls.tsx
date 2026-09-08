"use client";

import { useState } from "react";
import type { ReasoningSurface } from "../orchestrator/reasoning-router.ts";

const labels: Record<ReasoningSurface, string> = {
  chat: "Chatで続行",
  work: "Workを使用",
  codex: "Codexを使用",
};

export default function ReasoningSurfaceControls({
  enabled,
  approvalSurface,
  options,
}: {
  enabled: boolean;
  approvalSurface: "work" | "codex" | null;
  options: ReasoningSurface[];
}) {
  const [busy, setBusy] = useState<ReasoningSurface | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function choose(surface: ReasoningSurface) {
    if (!enabled || busy) return;
    setBusy(surface);
    setMessage(null);
    try {
      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: labels[surface] }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "選択の送信に失敗しました");
      setMessage(`${labels[surface]}を送信しました。AI社員の反映待ちです。`);
      window.setTimeout(() => window.location.reload(), 2500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "選択の送信に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="decision-actions" aria-label="推論モード選択">
        {(["chat", "work", "codex"] as const).map((surface) => {
          const allowed = options.includes(surface);
          const recommended = surface === approvalSurface;
          return (
            <button
              className={recommended ? "button command-send" : "button secondary"}
              disabled={!enabled || Boolean(busy) || !allowed}
              key={surface}
              onClick={() => void choose(surface)}
              type="button"
            >
              {busy === surface ? "送信中…" : labels[surface]}
              {!allowed && surface !== "chat" ? "（非推奨）" : ""}
            </button>
          );
        })}
      </div>
      {!enabled && <p className="inline-note">この端末をオーナー認証すると選択できます。</p>}
      {message && <p className="control-message" role="status">{message}</p>}
    </div>
  );
}
