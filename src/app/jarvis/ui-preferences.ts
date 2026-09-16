export const JARVIS_PREFERENCE_KEY = "jarvis-ui-preferences-v1";

export const JARVIS_THEMES = [
  ["jarvis", "JARVIS コア"], ["arc", "アーク・リアクター"], ["obsidian", "オブシディアン"], ["cobalt", "コバルト"],
  ["emerald", "エメラルド"], ["amber", "アンバー・オプス"], ["crimson", "クリムゾン"], ["violet", "バイオレット"],
  ["ice", "アイス"], ["solar", "ソーラー"], ["lunar", "ルナー"], ["titan", "タイタン"],
  ["neon", "ネオン・グリッド"], ["stealth", "ステルス"], ["ocean", "オーシャン"], ["forest", "フォレスト"],
  ["sand", "デザート"], ["mono", "モノクローム"], ["retro", "レトロ・ターミナル"], ["aurora", "オーロラ"],
] as const;

export const JARVIS_PERSONAS = [
  ["standard", "標準", "落ち着いた汎用オペレーター"],
  ["butler", "執事", "丁寧で先回りする補佐役"],
  ["commander", "司令官", "優先順位と進行を明確化"],
  ["engineer", "技術者", "実装・故障解析を重視"],
  ["researcher", "研究者", "根拠と検証を重視"],
  ["analyst", "分析官", "比較・差分・数値を重視"],
  ["navigator", "ナビゲーター", "次の一手と経路を重視"],
  ["mechanic", "整備士", "現物・手順・復旧を重視"],
  ["auditor", "監査官", "証拠・境界・矛盾を重視"],
  ["responder", "即応", "状況整理と即応を重視"],
  ["quiet", "静音", "通知と発話を最小化"],
  ["concise", "簡潔", "短く結論優先"],
  ["mentor", "教育", "理由と学習を重視"],
  ["creator", "創作", "発想と表現を重視"],
  ["strategist", "戦略", "長期Goalと依存関係を重視"],
  ["operator", "オペレーター", "操作と状態確認を重視"],
  ["concierge", "コンシェルジュ", "日常タスクの整理を重視"],
  ["archivist", "記録官", "履歴・決定・Evidenceを重視"],
  ["scout", "探索", "候補探索と未知の確認を重視"],
  ["adaptive", "適応", "Goalに応じて内部役割を切替"],
] as const;

export const JARVIS_VOICES = [
  ["neutral", "ニュートラル"], ["deep", "低め"], ["clear", "明瞭"], ["soft", "ソフト"],
  ["calm", "落ち着き"], ["fast", "テンポ速め"], ["brief", "短文"], ["silent", "テキスト優先"],
] as const;

export const JARVIS_ACCENTS = [
  ["cyan", "シアン", "#67e8f9"], ["blue", "ブルー", "#60a5fa"], ["green", "グリーン", "#4ade80"],
  ["amber", "アンバー", "#fbbf24"], ["red", "レッド", "#f87171"], ["violet", "バイオレット", "#a78bfa"],
  ["pink", "ピンク", "#f472b6"], ["white", "ホワイト", "#e2e8f0"],
] as const;

export const JARVIS_LAYOUTS = [
  ["command", "司令センター"], ["balanced", "バランス"], ["focus", "フォーカス"], ["mobile", "モバイル優先"],
] as const;

export type JarvisPreferences = {
  theme: string;
  persona: string;
  voice: string;
  accent: string;
  layout: string;
  density: "comfortable" | "compact";
  motion: "full" | "reduced";
};

export const DEFAULT_JARVIS_PREFERENCES: JarvisPreferences = {
  theme: "jarvis",
  persona: "standard",
  voice: "neutral",
  accent: "cyan",
  layout: "command",
  density: "comfortable",
  motion: "full",
};

function allowed(options: readonly (readonly [string, ...unknown[]])[], value: unknown, fallback: string) {
  return typeof value === "string" && options.some(([id]) => id === value) ? value : fallback;
}

export function normalizeJarvisPreferences(value: unknown): JarvisPreferences {
  const candidate = value && typeof value === "object" ? value as Partial<JarvisPreferences> : {};
  return {
    theme: allowed(JARVIS_THEMES, candidate.theme, DEFAULT_JARVIS_PREFERENCES.theme),
    persona: allowed(JARVIS_PERSONAS, candidate.persona, DEFAULT_JARVIS_PREFERENCES.persona),
    voice: allowed(JARVIS_VOICES, candidate.voice, DEFAULT_JARVIS_PREFERENCES.voice),
    accent: allowed(JARVIS_ACCENTS, candidate.accent, DEFAULT_JARVIS_PREFERENCES.accent),
    layout: allowed(JARVIS_LAYOUTS, candidate.layout, DEFAULT_JARVIS_PREFERENCES.layout),
    density: candidate.density === "compact" ? "compact" : "comfortable",
    motion: candidate.motion === "reduced" ? "reduced" : "full",
  };
}

export function readJarvisPreferences(): JarvisPreferences {
  try {
    const raw = window.localStorage.getItem(JARVIS_PREFERENCE_KEY);
    return raw ? normalizeJarvisPreferences(JSON.parse(raw)) : { ...DEFAULT_JARVIS_PREFERENCES };
  } catch {
    return { ...DEFAULT_JARVIS_PREFERENCES };
  }
}

export function writeJarvisPreferences(preferences: JarvisPreferences) {
  window.localStorage.setItem(JARVIS_PREFERENCE_KEY, JSON.stringify(normalizeJarvisPreferences(preferences)));
}

export function applyJarvisPreferences(preferences: JarvisPreferences) {
  const normalized = normalizeJarvisPreferences(preferences);
  const root = document.documentElement;
  root.dataset.jarvisTheme = normalized.theme;
  root.dataset.jarvisPersona = normalized.persona;
  root.dataset.jarvisVoice = normalized.voice;
  root.dataset.jarvisAccent = normalized.accent;
  root.dataset.jarvisLayout = normalized.layout;
  root.dataset.jarvisDensity = normalized.density;
  root.dataset.jarvisMotion = normalized.motion;
  const accent = JARVIS_ACCENTS.find(([id]) => id === normalized.accent)?.[2] ?? JARVIS_ACCENTS[0][2];
  root.style.setProperty("--jarvis-accent", accent);
}
