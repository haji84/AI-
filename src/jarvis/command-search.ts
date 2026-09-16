export type JarvisCommandSearchItem = {
  id: string;
  href: string;
  label: string;
  description: string;
  aliases: readonly string[];
};

export const JARVIS_COMMAND_SEARCH_ITEMS = [
  {
    id: "home",
    href: "/jarvis",
    label: "ホーム",
    description: "現在の状態、目標、主要操作を開く",
    aliases: ["home", "トップ", "状態", "ダッシュボード"],
  },
  {
    id: "devices",
    href: "/jarvis/devices",
    label: "デバイス",
    description: "接続端末、Remote Assist、Live Viewを開く",
    aliases: ["devices", "端末", "remote assist", "live view", "遠隔操作"],
  },
  {
    id: "tasks",
    href: "/jarvis/tasks",
    label: "タスク",
    description: "タスクキューと実行履歴を確認する",
    aliases: ["tasks", "仕事", "キュー", "履歴"],
  },
  {
    id: "research",
    href: "/jarvis/research",
    label: "リサーチ",
    description: "製品トラックとResearch Opsを確認する",
    aliases: ["research", "研究", "r1", "r20", "evidence"],
  },
  {
    id: "settings",
    href: "/jarvis/settings",
    label: "設定",
    description: "テーマ、ペルソナ、表示設定を開く",
    aliases: ["settings", "theme", "persona", "テーマ", "ペルソナ"],
  },
  {
    id: "enroll",
    href: "/jarvis/enroll",
    label: "端末登録",
    description: "オーナー管理の端末登録とペアリングを開く",
    aliases: ["enroll", "pairing", "登録", "ペアリング", "qr"],
  },
  {
    id: "recordings",
    href: "/jarvis/recordings",
    label: "録画履歴",
    description: "Remote Assistの保存済み画面記録を確認する",
    aliases: ["recordings", "recording", "録画", "画面記録", "remote assist"],
  },
] as const satisfies readonly JarvisCommandSearchItem[];

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
}

function scoreItem(item: JarvisCommandSearchItem, normalizedQuery: string) {
  if (!normalizedQuery) return 10;

  const label = normalizeSearchText(item.label);
  const aliases = item.aliases.map(normalizeSearchText);
  if (label === normalizedQuery || aliases.includes(normalizedQuery)) return 0;
  if (label.startsWith(normalizedQuery) || aliases.some((alias) => alias.startsWith(normalizedQuery))) return 1;

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const haystack = normalizeSearchText([
    item.label,
    item.description,
    item.href,
    ...item.aliases,
  ].join(" "));
  return terms.every((term) => haystack.includes(term)) ? 2 : Number.POSITIVE_INFINITY;
}

export function searchJarvisCommands(query: string, limit = 7): JarvisCommandSearchItem[] {
  const normalizedQuery = normalizeSearchText(query);
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.min(JARVIS_COMMAND_SEARCH_ITEMS.length, Math.trunc(limit))) : JARVIS_COMMAND_SEARCH_ITEMS.length;

  return JARVIS_COMMAND_SEARCH_ITEMS
    .map((item, index) => ({ item, index, score: scoreItem(item, normalizedQuery) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, safeLimit)
    .map((entry) => entry.item);
}
