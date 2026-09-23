"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { deriveJarvisPriorityNotifications, type JarvisTaskStats } from "./notification-priority";

type StatePayload = {
  stats: JarvisTaskStats;
  message?: string;
};

export default function JarvisPriorityNotifications() {
  const [stats, setStats] = useState<JarvisTaskStats | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/state", { cache: "no-store" });
      const body = await response.json() as StatePayload;
      if (!response.ok) {
        if (response.status === 401) throw new Error("通知状態の確認にはオーナー認証が必要です。");
        throw new Error(body.message || `通知状態を取得できません (HTTP ${response.status})`);
      }
      setStats(body.stats);
      setError("");
    } catch (cause) {
      setStats(null);
      setError(cause instanceof Error ? cause.message : "通知状態を取得できません");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const notifications = useMemo(
    () => stats ? deriveJarvisPriorityNotifications(stats) : [],
    [stats],
  );

  return (
    <aside className={`panel jarvis-section jarvis-priority-notifications${stats && !error && notifications.length === 0 ? " is-quiet" : ""}`} aria-label="優先通知" aria-live="polite">
      <div className="jarvis-screen-heading compact">
        <div>
          <p className="eyebrow">PRIORITY NOTIFICATIONS</p>
          <strong>優先通知</strong>
        </div>
        <a className="button secondary" href="/jarvis/tasks">タスクを見る</a>
      </div>

      {error ? (
        <div className="jarvis-alert">
          <strong>通知状態を確認できません</strong>
          <span>{error}</span>
          <a className="button secondary" href="/jarvis/login?next=/jarvis">オーナー認証</a>
        </div>
      ) : notifications.length > 0 ? (
        <div className="jarvis-stats" role="list" aria-label="重要度順の通知">
          {notifications.map((notification) => (
            <a key={notification.id} role="listitem" href={notification.href} className="panel">
              <span>{notification.priority === "critical" ? "最優先" : notification.priority === "attention" ? "要確認" : "進行中"}</span>
              <strong>{notification.label}</strong>
              <small>{notification.detail}</small>
            </a>
          ))}
        </div>
      ) : stats ? (
        <p className="muted">重要な通知はありません。</p>
      ) : (
        <p className="muted">通知状態を確認中…</p>
      )}

      <p className="jarvis-boundary-note">通知は状態表示だけ。ここからHuman Gate承認や端末操作は実行しない。</p>
    </aside>
  );
}
