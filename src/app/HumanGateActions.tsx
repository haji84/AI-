"use client";

import { useState } from "react";
import ApprovalControls from "./ApprovalControls.tsx";

export default function HumanGateActions({ approvalKey }: { approvalKey: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reject() {
    setRejecting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "却下に失敗しました");
      setMessage("却下してAI社員を停止しました");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "却下に失敗しました");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className="gate-actions">
      <ApprovalControls approvalKey={approvalKey} />
      <button className="button danger-ghost" disabled={rejecting} onClick={reject} type="button">
        {rejecting ? "停止中…" : "却下して停止"}
      </button>
      {message && <span className="gate-message">{message}</span>}
    </div>
  );
}
