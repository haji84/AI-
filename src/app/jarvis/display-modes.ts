export const JARVIS_DISPLAY_MODE_KEY = "jarvis-display-mode-v1";

export const JARVIS_DISPLAY_MODES = [
  ["standard", "標準", "通常表示"],
  ["focus", "フォーカス", "補助表示を抑えて作業中の内容を見やすくする"],
  ["distance", "遠距離", "文字と操作対象を大きくして離れた位置から見やすくする"],
  ["privacy", "プライバシー", "端末画面・登録トークンなど機密表示をブラックアウトする"],
] as const;

export type JarvisDisplayMode = (typeof JARVIS_DISPLAY_MODES)[number][0];

export function normalizeJarvisDisplayMode(value: unknown): JarvisDisplayMode {
  return typeof value === "string" && JARVIS_DISPLAY_MODES.some(([id]) => id === value)
    ? value as JarvisDisplayMode
    : "standard";
}

export function readJarvisDisplayMode(): JarvisDisplayMode {
  try {
    return normalizeJarvisDisplayMode(window.localStorage.getItem(JARVIS_DISPLAY_MODE_KEY));
  } catch {
    return "standard";
  }
}

export function writeJarvisDisplayMode(mode: JarvisDisplayMode) {
  window.localStorage.setItem(JARVIS_DISPLAY_MODE_KEY, normalizeJarvisDisplayMode(mode));
}

export function applyJarvisDisplayMode(mode: JarvisDisplayMode) {
  document.documentElement.dataset.jarvisDisplayMode = normalizeJarvisDisplayMode(mode);
}
