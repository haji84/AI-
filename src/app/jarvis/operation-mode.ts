export const JARVIS_OPERATION_MODE_KEY = "jarvis-operation-mode-v1";

export const JARVIS_OPERATION_MODES = [
  ["standard", "標準", "通常のJARVIS操作"],
  ["read-only", "読み取り専用", "状態確認とJARVIS内の安全な画面移動だけを許可"],
  ["kiosk", "キオスク", "読み取り専用に加えて補助ナビゲーションを抑える"],
] as const;

export type JarvisOperationMode = (typeof JARVIS_OPERATION_MODES)[number][0];

export function normalizeJarvisOperationMode(value: unknown): JarvisOperationMode {
  return typeof value === "string" && JARVIS_OPERATION_MODES.some(([id]) => id === value)
    ? value as JarvisOperationMode
    : "standard";
}

export function isJarvisReadOnlyMode(mode: JarvisOperationMode) {
  return mode === "read-only" || mode === "kiosk";
}

export function isSafeJarvisReadOnlyHref(rawHref: string) {
  if (rawHref === "/") return true;
  return rawHref === "/jarvis" || rawHref.startsWith("/jarvis?") || rawHref.startsWith("/jarvis/");
}

export function readJarvisOperationMode(): JarvisOperationMode {
  try {
    return normalizeJarvisOperationMode(window.localStorage.getItem(JARVIS_OPERATION_MODE_KEY));
  } catch {
    return "standard";
  }
}

export function writeJarvisOperationMode(mode: JarvisOperationMode) {
  window.localStorage.setItem(JARVIS_OPERATION_MODE_KEY, normalizeJarvisOperationMode(mode));
}

export function applyJarvisOperationMode(mode: JarvisOperationMode) {
  document.documentElement.dataset.jarvisOperationMode = normalizeJarvisOperationMode(mode);
}
