export const JARVIS_ACCESSIBILITY_PREFERENCE_KEY = "jarvis-accessibility-preferences-v1";

export type JarvisAccessibilityPreferences = {
  textScale: "standard" | "large";
  contrast: "standard" | "high";
  captions: "off" | "on";
};

export const DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES: JarvisAccessibilityPreferences = {
  textScale: "standard",
  contrast: "standard",
  captions: "off",
};

export function normalizeJarvisAccessibilityPreferences(value: unknown): JarvisAccessibilityPreferences {
  const candidate = value && typeof value === "object"
    ? value as Partial<JarvisAccessibilityPreferences>
    : {};

  return {
    textScale: candidate.textScale === "large" ? "large" : "standard",
    contrast: candidate.contrast === "high" ? "high" : "standard",
    captions: candidate.captions === "on" ? "on" : "off",
  };
}

export function readJarvisAccessibilityPreferences(): JarvisAccessibilityPreferences {
  try {
    const raw = window.localStorage.getItem(JARVIS_ACCESSIBILITY_PREFERENCE_KEY);
    return raw
      ? normalizeJarvisAccessibilityPreferences(JSON.parse(raw))
      : { ...DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES };
  } catch {
    return { ...DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES };
  }
}

export function writeJarvisAccessibilityPreferences(preferences: JarvisAccessibilityPreferences) {
  window.localStorage.setItem(
    JARVIS_ACCESSIBILITY_PREFERENCE_KEY,
    JSON.stringify(normalizeJarvisAccessibilityPreferences(preferences)),
  );
}

export function applyJarvisAccessibilityPreferences(preferences: JarvisAccessibilityPreferences) {
  const normalized = normalizeJarvisAccessibilityPreferences(preferences);
  const root = document.documentElement;
  root.dataset.jarvisTextScale = normalized.textScale;
  root.dataset.jarvisContrast = normalized.contrast;
  root.dataset.jarvisCaptions = normalized.captions;
}
