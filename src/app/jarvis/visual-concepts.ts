/** Fixed presentation metadata. Concepts do not select a persona, model, tool or runtime. */
export const VISUAL_CONCEPT_IDS = [
  "clean-modern", "dark-cinema", "anime-assistant", "portrait-assistant", "portrait-partner",
  "anime-partner", "hologram", "ai-core", "butler", "team", "future-lab", "space-bridge",
  "cockpit", "ar-space", "cyber-city", "nature", "black-gold", "silver-lab", "digital-twin", "adaptive",
] as const;

export type VisualConceptId = typeof VISUAL_CONCEPT_IDS[number];
export interface VisualConcept {
  readonly id: VisualConceptId;
  readonly label: string;
  readonly description: string;
  readonly mode: "light" | "dark";
  readonly accent: string;
  readonly accentText: string;
  readonly background: string;
  readonly panel: string;
  readonly panelElevated: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly geometry: string;
  readonly radius: number;
  readonly atlas: string;
  readonly grid: Readonly<{ columns: 2; rows: 1 | 3; column: 0 | 1; row: 0 | 1 | 2 }>;
}
export type VisualConceptStyle = Record<`--personal-${string}`, string>;

type Palette = Pick<VisualConcept, "background" | "panel" | "panelElevated" | "text" | "muted" | "border">;
const light: Palette = { background: "#edf2f7", panel: "#ffffff", panelElevated: "#f6f8fb", text: "#17263a", muted: "#506076", border: "#9cabbc" };
const dark: Palette = { background: "#080f1b", panel: "#111d2e", panelElevated: "#17263a", text: "#f2f7ff", muted: "#afc0d4", border: "#50627a" };
const warm: Palette = { background: "#f5eee7", panel: "#fffaf5", panelElevated: "#f8f1e9", text: "#352a29", muted: "#6c5550", border: "#ae9387" };
const forest: Palette = { background: "#eef3e9", panel: "#fcfef9", panelElevated: "#f3f7ed", text: "#263b2c", muted: "#526852", border: "#99ac94" };
const violet: Palette = { background: "#110d20", panel: "#1b1630", panelElevated: "#271e40", text: "#f9f3ff", muted: "#c6b8dc", border: "#695780" };
const gold: Palette = { background: "#11100d", panel: "#201d17", panelElevated: "#2b261d", text: "#fff8e9", muted: "#ccbea4", border: "#796b50" };
const atlasPaths = ["/jarvis/concepts/scenes-a.png", "/jarvis/concepts/scenes-b.png", "/jarvis/concepts/scenes-c.png", "/jarvis/concepts/scenes-d.png"] as const;

function concept(index: number, label: string, description: string, mode: "light" | "dark", palette: Palette, accent: string, radius: number, geometry: string): VisualConcept {
  const group = Math.floor(index / 6);
  const cell = index % 6;
  return Object.freeze({
    id: VISUAL_CONCEPT_IDS[index], label, description, mode, ...palette, accent,
    accentText: mode === "light" ? "#ffffff" : "#0a101a", radius, geometry,
    atlas: atlasPaths[group],
    grid: Object.freeze({ columns: 2 as const, rows: group === 3 ? 1 as const : 3 as const, column: cell % 2 as 0 | 1, row: Math.floor(cell / 2) as 0 | 1 | 2 }),
  });
}

/** Atlas order is shared with the generated local artwork; never accept remote image URLs. */
export const VISUAL_CONCEPTS: readonly VisualConcept[] = Object.freeze([
  concept(0, "クリーン・モダン", "白い建築と柔らかな光。余白のある、静かなワークスペース。", "light", light, "#235bc2", 24,
    "radial-gradient(ellipse at 100% 0%, #c7d8f255, transparent 56%)"),
  concept(1, "ダーク・シネマ", "映画のワンシーンのような陰影と、深いネイビーの空間。", "dark", dark, "#90baff", 16,
    "linear-gradient(115deg, transparent 30%, #41639c22 50%, transparent 72%)"),
  concept(2, "アニメ・アシスタント", "青い光に包まれたアニメ調のアシスタントと、明快なパネル。", "light", light, "#4851b5", 22,
    "radial-gradient(circle at 88% 14%, #96c7ff44 0 8%, transparent 8.2%), radial-gradient(circle at 94% 0%, #b4b6ec33, transparent 52%)"),
  concept(3, "ポートレート・アシスタント", "自然光のポートレートと、落ち着いた青のデスク空間。", "light", light, "#235d7e", 18,
    "linear-gradient(100deg, #abc5d433, transparent 48%), linear-gradient(0deg, #c7d6e322 1px, transparent 1px)"),
  concept(4, "ポートレート・パートナー", "暖かな肖像とソフトな曲線。日々の作業に馴染むトーン。", "light", warm, "#914549", 28,
    "radial-gradient(ellipse at 0% 0%, #e5b6ab44, transparent 55%), radial-gradient(ellipse at 100% 90%, #efd2ad55, transparent 46%)"),
  concept(5, "アニメ・パートナー", "淡い藤色とイラストの表情。軽やかで親しみのある空間。", "light", { ...light, background: "#f3eff8", panelElevated: "#f8f5fc", muted: "#625773" }, "#7e438b", 30,
    "radial-gradient(circle at 93% 5%, #e8b4e655 0 12%, transparent 12.2%), linear-gradient(160deg, #ddc9f344, transparent 60%)"),
  concept(6, "ホログラム", "透明な光のシルエットと、シアンの細いフレーム。", "dark", dark, "#69e4f4", 12,
    "repeating-linear-gradient(0deg, transparent 0 47px, #67e8f90b 47px 48px), radial-gradient(ellipse at 50% 0%, #19c5ea22, transparent 65%)"),
  concept(7, "AI コア", "中央に集まるエネルギーの造形と、円を重ねたデザイン。", "dark", dark, "#82e6da", 24,
    "radial-gradient(circle at 80% 0%, transparent 0 150px, #5fe6d21a 151px 152px, transparent 153px 220px, #5fe6d211 221px 223px, transparent 224px)"),
  concept(8, "クラシック・バトラー", "端正な装いと銅色のディテール。静かな書斎の雰囲気。", "dark", gold, "#ecc093", 10,
    "repeating-linear-gradient(90deg, transparent 0 119px, #d2b68a0b 120px 121px), linear-gradient(180deg, #63472724, transparent 38%)"),
  concept(9, "チーム・スタジオ", "多彩な人物を描いたスタジオアートと、整然とした区画。", "light", light, "#475bb5", 16,
    "linear-gradient(90deg, #c7d3f033 25%, transparent 25% 75%, #d5e2ef33 75%), linear-gradient(0deg, transparent 49%, #ccd7e633 50%, transparent 51%)"),
  concept(10, "フューチャー・ラボ", "白い実験室の建築をモチーフにした、精密で澄んだ空間。", "light", light, "#146678", 12,
    "repeating-linear-gradient(90deg, transparent 0 79px, #63aabc11 80px 81px), repeating-linear-gradient(0deg, transparent 0 79px, #63aabc11 80px 81px)"),
  concept(11, "スペース・ブリッジ", "星々を望む宇宙船のブリッジと、広がりのある濃紺。", "dark", dark, "#a9b7ff", 14,
    "radial-gradient(circle at 20% 12%, #b8c8ff88 0 1px, transparent 2px), radial-gradient(circle at 78% 26%, #b8c8ff66 0 1px, transparent 2px), linear-gradient(150deg, #273e6922, transparent 60%)"),
  concept(12, "コックピット", "視線を前へ導く操縦席のアートと、シャープな輪郭。", "dark", dark, "#8bdafa", 8,
    "linear-gradient(135deg, transparent 47%, #7bb4d41a 48% 48.2%, transparent 49%), linear-gradient(225deg, transparent 47%, #7bb4d41a 48% 48.2%, transparent 49%)"),
  concept(13, "AR スペース", "光のフレームが浮かぶ空間表現と、抜けのよい淡い青。", "light", light, "#17637d", 20,
    "linear-gradient(90deg, #82c9dc22 1px, transparent 1px), linear-gradient(135deg, transparent 60%, #aed5e744 60% 75%, transparent 75%)"),
  concept(14, "サイバー・シティ", "夜の街と紫のネオン。縦に伸びる光がつくるリズム。", "dark", violet, "#e4a6ff", 12,
    "repeating-linear-gradient(90deg, transparent 0 89px, #cb63ff12 90px 92px, transparent 93px 132px), linear-gradient(160deg, #53277133, transparent 55%)"),
  concept(15, "ネイチャー", "緑と木漏れ日を感じる風景。穏やかな色と有機的な曲線。", "light", forest, "#336244", 28,
    "radial-gradient(ellipse at 0% 100%, #a6c99855, transparent 52%), radial-gradient(ellipse at 100% 0%, #d2ddac66, transparent 50%)"),
  concept(16, "ブラック ＆ ゴールド", "黒と金の建築的なコントラスト。細い線で整える空間。", "dark", gold, "#e6c578", 10,
    "linear-gradient(120deg, transparent 62%, #d8b26016 62.1% 62.3%, transparent 62.4%), linear-gradient(60deg, transparent 80%, #d8b26014 80.1% 80.3%, transparent 80.4%)"),
  concept(17, "シルバー・ラボ", "白銀の素材とクールな光。無駄を抑えた整然とした構成。", "light", { ...light, background: "#eceff3", panelElevated: "#f5f6f8" }, "#49596f", 14,
    "linear-gradient(110deg, #c5cbd733, transparent 30% 65%, #c5cbd744), repeating-linear-gradient(0deg, transparent 0 159px, #9dabb811 160px 161px)"),
  concept(18, "デジタル・ツイン", "青い都市模型を描いたアートと、図面を思わせる線の構成。", "dark", dark, "#7ed5f1", 10,
    "repeating-linear-gradient(30deg, transparent 0 99px, #53bcdb10 100px 101px), repeating-linear-gradient(150deg, transparent 0 99px, #53bcdb10 100px 101px)"),
  concept(19, "アダプティブ", "色の流れと抽象的な光。柔らかなグラデーションを楽しむ空間。", "dark", violet, "#c7b8ff", 26,
    "radial-gradient(ellipse at 0% 0%, #4cb6c52a, transparent 48%), radial-gradient(ellipse at 100% 50%, #a276e933, transparent 50%), radial-gradient(ellipse at 40% 100%, #b7659722, transparent 50%)"),
]);

export function findVisualConcept(id: unknown): VisualConcept | null {
  return typeof id === "string" ? VISUAL_CONCEPTS.find((item) => item.id === id) ?? null : null;
}

export function visualConceptStyle(value: VisualConcept): VisualConceptStyle {
  // Resolve again from our manifest: callers cannot supply a custom URL or CSS value.
  const item = findVisualConcept(value?.id);
  if (!item) return {};
  return {
    "--personal-bg": item.background,
    "--personal-panel": item.panel,
    "--personal-panel-elevated": item.panelElevated,
    "--personal-text": item.text,
    "--personal-muted": item.muted,
    "--personal-border": item.border,
    "--personal-accent": item.accent,
    "--personal-accent-text": item.accentText,
    "--personal-mode": item.mode,
    "--personal-radius": `${item.radius}px`,
    "--personal-geometry": item.geometry,
    "--personal-art": `url("${item.atlas}")`,
    "--personal-art-size": item.grid.rows === 1 ? "220% 110%" : "220% 340%",
    "--personal-art-position": `${item.grid.column * 100}% ${item.grid.rows === 1 ? 0 : item.grid.row * 50}%`,
    "--personal-success": item.mode === "light" ? "#21613a" : "#8fe7ad",
    "--personal-warning": item.mode === "light" ? "#785113" : "#f5d58a",
    "--personal-danger": item.mode === "light" ? "#a42d3c" : "#ffabb2",
  };
}

/** A null/unknown selection removes this layer and restores legacy theme styling. */
export function applyVisualConcept(id: string | null): VisualConcept | null {
  const item = findVisualConcept(id);
  if (typeof document === "undefined") return item;
  const root = document.documentElement;
  if (!item) {
    delete root.dataset.jarvisConcept;
    for (const key of Object.keys(visualConceptStyle(VISUAL_CONCEPTS[0]))) root.style.removeProperty(key);
    return null;
  }
  root.dataset.jarvisConcept = item.id;
  for (const [key, value] of Object.entries(visualConceptStyle(item))) root.style.setProperty(key, value);
  return item;
}
