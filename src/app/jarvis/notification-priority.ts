export type JarvisTaskStats = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  needsHuman: number;
};

export type JarvisNotificationPriority = "critical" | "attention" | "activity";

export type JarvisPriorityNotification = {
  id: "human-gate" | "failed" | "running" | "queued";
  priority: JarvisNotificationPriority;
  rank: number;
  label: string;
  detail: string;
  href: "/jarvis/tasks";
};

function safeCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function deriveJarvisPriorityNotifications(stats: JarvisTaskStats): JarvisPriorityNotification[] {
  const notifications: JarvisPriorityNotification[] = [];
  const needsHuman = safeCount(stats.needsHuman);
  const failed = safeCount(stats.failed);
  const running = safeCount(stats.running);
  const queued = safeCount(stats.queued);

  if (needsHuman > 0) {
    notifications.push({
      id: "human-gate",
      priority: "critical",
      rank: 0,
      label: "判断が必要",
      detail: `Human Gate待ち ${needsHuman}件`,
      href: "/jarvis/tasks",
    });
  }

  if (failed > 0) {
    notifications.push({
      id: "failed",
      priority: "attention",
      rank: 1,
      label: "失敗を確認",
      detail: `失敗タスク ${failed}件`,
      href: "/jarvis/tasks",
    });
  }

  if (running > 0) {
    notifications.push({
      id: "running",
      priority: "activity",
      rank: 2,
      label: "実行中",
      detail: `実行中 ${running}件`,
      href: "/jarvis/tasks",
    });
  }

  if (queued > 0) {
    notifications.push({
      id: "queued",
      priority: "activity",
      rank: 3,
      label: "待機中",
      detail: `Queue ${queued}件`,
      href: "/jarvis/tasks",
    });
  }

  return notifications.sort((a, b) => a.rank - b.rank);
}
