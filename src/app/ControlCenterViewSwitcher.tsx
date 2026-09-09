"use client";

import { ReactNode, useEffect, useState } from "react";

type ControlCenterView = "dashboard" | "chat";

const STORAGE_KEY = "ai_company_control_center_view_v1";

export default function ControlCenterViewSwitcher({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ControlCenterView>("dashboard");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "chat" || stored === "dashboard") setView(stored);
    } catch {
      // Persistence is optional. View switching still works in-memory.
    }
  }, []);

  function select(next: ControlCenterView) {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is optional. View switching still works in-memory.
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className={`control-center-view view-${view}`}>
      <div className="view-switcher" role="tablist" aria-label="表示切替">
        <button
          aria-selected={view === "dashboard"}
          className={view === "dashboard" ? "active" : ""}
          onClick={() => select("dashboard")}
          role="tab"
          type="button"
        >
          <span>ダッシュボード</span>
          <small>状況・タスク・承認</small>
        </button>
        <button
          aria-selected={view === "chat"}
          className={view === "chat" ? "active" : ""}
          onClick={() => select("chat")}
          role="tab"
          type="button"
        >
          <span>AI Chat</span>
          <small>会話・指示に集中</small>
        </button>
      </div>
      {children}
    </div>
  );
}
