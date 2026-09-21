export const JARVIS_THEME_IDS = [
  "clean-modern","dark-cinematic","soft-anime","warm-companion","executive",
  "hologram","natural-wood","minimal-glass","ar-spatial","cyber-city",
  "future-cockpit","mobile-compact","mission-control","data-visual","healing-nature",
  "natural-fusion","black-gold","white-lab","digital-twin","adaptive-persona",
] as const;

export type JarvisThemeId = typeof JARVIS_THEME_IDS[number];

export interface JarvisTheme {
  id: JarvisThemeId;
  label: string;
  mode: "light" | "dark";
  density: "comfortable" | "compact" | "dense";
  backdrop: string;
  radius: number;
  glow: number;
  motionIntensity: number;
}

const labels = [
  "クリーンモダン","ダークシネマティック","ソフトアニメ調","ウォームコンパニオン","エグゼクティブ",
  "ホログラム","ナチュラルウッド","ミニマルGlass","AR空間","サイバーシティ",
  "未来コックピット","モバイル特化","Mission Control","データビジュアル","癒し・自然",
  "自然融合","ブラック＆ゴールド","白銀ラボ","デジタルツイン","アダプティブ・ペルソナ",
] as const;

export const JARVIS_THEMES: readonly JarvisTheme[] = JARVIS_THEME_IDS.map((id, index) => ({
  id,
  label: labels[index],
  mode: ["dark-cinematic","hologram","cyber-city","future-cockpit","mission-control","black-gold","digital-twin"].includes(id) ? "dark" : "light",
  density: id === "mission-control" || id === "data-visual" ? "dense" : id === "mobile-compact" ? "compact" : "comfortable",
  backdrop: id,
  radius: ["future-cockpit","mission-control","data-visual"].includes(id) ? 10 : 20,
  glow: ["hologram","ar-spatial","cyber-city","future-cockpit","digital-twin"].includes(id) ? 1 : 0,
  motionIntensity: id === "adaptive-persona" ? 0.7 : 0.35,
}));

export function jarvisTheme(id: string | null | undefined): JarvisTheme {
  return JARVIS_THEMES.find((theme) => theme.id === id) ?? JARVIS_THEMES[0];
}
