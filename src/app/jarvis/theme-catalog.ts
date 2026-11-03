export const JARVIS_THEME_IDS = [
  "clean-modern","dark-cinematic","soft-anime","warm-companion","executive",
  "hologram","natural-wood","minimal-glass","ar-spatial","cyber-city",
  "future-cockpit","mobile-compact","mission-control","data-visual","healing-nature",
  "natural-fusion","black-gold","white-lab","digital-twin","adaptive-persona",
  "ref-a-clean-modern","ref-a-dark-cinematic","ref-a-anime-secretary","ref-a-real-secretary","ref-a-male-secretary",
  "ref-a-hologram-space","ref-a-natural-wood","ref-a-minimal-glass","ref-a-ar-space","ref-a-cyber-city",
  "ref-a-cockpit","ref-a-mobile-first","ref-a-dual-monitor","ref-a-data-visual","ref-a-healing-space",
] as const;

export type JarvisThemeId = typeof JARVIS_THEME_IDS[number];

export interface JarvisTheme {
  id: JarvisThemeId;
  label: string;
  referenceSet: "A" | "B";
  mode: "light" | "dark";
  density: "comfortable" | "compact" | "dense";
  backdrop: string;
  radius: number;
  glow: number;
  motionIntensity: number;
}

const labels = [
  "クリーンモダン","ダークシネマティック","アニメ美人秘書","リアル美人秘書","リアルイケメン秘書",
  "アニメイケメン秘書","ホログラム人型","AIコア型","執事型JARVIS","秘書チーム型",
  "未来研究室型","宇宙船ブリッジ型","高級車コックピット型","AR空間型","サイバーシティ型",
  "自然融合型","ブラック＆ゴールド","白銀ラボ型","デジタルツイン型","可変人格型",
  "クリーンモダン","ダークシネマティック","アニメ調 美人秘書","リアル 美人秘書","イケメン秘書",
  "ホログラム空間","ナチュラルウッド","ミニマルGlass","AR空間UI","サイバーシティ",
  "コックピット","モバイル特化","デュアルモニター","データビジュアル","癒し空間",
] as const;

const DARK_IDS = new Set<JarvisThemeId>([
  "dark-cinematic","hologram","ar-spatial","cyber-city","future-cockpit","mission-control","black-gold","digital-twin",
  "ref-a-dark-cinematic","ref-a-hologram-space","ref-a-ar-space","ref-a-cyber-city","ref-a-cockpit","ref-a-dual-monitor",
]);

const DENSE_IDS = new Set<JarvisThemeId>(["mission-control","data-visual","ref-a-dual-monitor","ref-a-data-visual"]);
const COMPACT_IDS = new Set<JarvisThemeId>(["mobile-compact","ref-a-mobile-first"]);
const SQUARE_IDS = new Set<JarvisThemeId>(["future-cockpit","mission-control","data-visual","ref-a-cockpit","ref-a-dual-monitor","ref-a-data-visual"]);
const GLOW_IDS = new Set<JarvisThemeId>([
  "hologram","ar-spatial","cyber-city","future-cockpit","digital-twin",
  "ref-a-hologram-space","ref-a-ar-space","ref-a-cyber-city","ref-a-cockpit",
]);

export const JARVIS_THEMES: readonly JarvisTheme[] = JARVIS_THEME_IDS.map((id, index) => ({
  id,
  label: labels[index],
  referenceSet: index < 20 ? "B" : "A",
  mode: DARK_IDS.has(id) ? "dark" : "light",
  density: DENSE_IDS.has(id) ? "dense" : COMPACT_IDS.has(id) ? "compact" : "comfortable",
  backdrop: id,
  radius: SQUARE_IDS.has(id) ? 10 : 20,
  glow: GLOW_IDS.has(id) ? 1 : 0,
  motionIntensity: id === "adaptive-persona" ? 0.7 : 0.35,
}));

export function jarvisTheme(id: string | null | undefined): JarvisTheme {
  return JARVIS_THEMES.find((theme) => theme.id === id) ?? JARVIS_THEMES[0];
}
