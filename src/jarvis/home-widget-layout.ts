export const JARVIS_HOME_WIDGET_LAYOUT_KEY = "jarvis-home-widget-layout-v1";

export const JARVIS_HOME_WIDGETS = [
  { id: "status", label: "稼働サマリー", selector: ".jarvis-stats", critical: false },
  { id: "quick-actions", label: "端末追加・URLジョブ", selector: ".jarvis-grid", critical: false },
  { id: "remote-assist", label: "Remote Assist", selector: ".jarvis-remote-panel", critical: false },
  { id: "multi-view", label: "複数端末ビュー", selector: ".jarvis-multiview-panel", critical: false },
  { id: "human-takeover", label: "Human Takeover", selector: ".jarvis-takeover", critical: true },
] as const;

export type JarvisHomeWidgetId = typeof JARVIS_HOME_WIDGETS[number]["id"];
export type JarvisHomeWidgetSize = "normal" | "wide" | "full";

export type JarvisHomeWidgetLayout = {
  order: JarvisHomeWidgetId[];
  hidden: JarvisHomeWidgetId[];
  sizes: Record<JarvisHomeWidgetId, JarvisHomeWidgetSize>;
};

const IDS = JARVIS_HOME_WIDGETS.map((widget) => widget.id);
const ID_SET = new Set<string>(IDS);
const CRITICAL_IDS = new Set<JarvisHomeWidgetId>(JARVIS_HOME_WIDGETS.filter((widget) => widget.critical).map((widget) => widget.id));
const SIZES = new Set<JarvisHomeWidgetSize>(["normal", "wide", "full"]);

export const DEFAULT_JARVIS_HOME_WIDGET_LAYOUT: JarvisHomeWidgetLayout = {
  order: [...IDS],
  hidden: [],
  sizes: Object.fromEntries(IDS.map((id) => [id, "full"])) as Record<JarvisHomeWidgetId, JarvisHomeWidgetSize>,
};

function isWidgetId(value: unknown): value is JarvisHomeWidgetId {
  return typeof value === "string" && ID_SET.has(value);
}

function normalizeOrder(value: unknown): JarvisHomeWidgetId[] {
  const seen = new Set<JarvisHomeWidgetId>();
  const result: JarvisHomeWidgetId[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isWidgetId(item) || seen.has(item)) continue;
      seen.add(item);
      result.push(item);
    }
  }
  for (const id of IDS) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

export function normalizeJarvisHomeWidgetLayout(value: unknown): JarvisHomeWidgetLayout {
  const candidate = value && typeof value === "object" ? value as Partial<JarvisHomeWidgetLayout> : {};
  const hidden = Array.isArray(candidate.hidden)
    ? [...new Set(candidate.hidden.filter(isWidgetId))].filter((id) => !CRITICAL_IDS.has(id))
    : [];
  const sourceSizes = candidate.sizes && typeof candidate.sizes === "object" ? candidate.sizes : {};
  const sizes = Object.fromEntries(IDS.map((id) => {
    const size = (sourceSizes as Partial<Record<JarvisHomeWidgetId, unknown>>)[id];
    return [id, SIZES.has(size as JarvisHomeWidgetSize) ? size : "full"];
  })) as Record<JarvisHomeWidgetId, JarvisHomeWidgetSize>;
  return { order: normalizeOrder(candidate.order), hidden, sizes };
}

export function reorderJarvisHomeWidget(
  layout: JarvisHomeWidgetLayout,
  movingId: JarvisHomeWidgetId,
  targetId: JarvisHomeWidgetId,
): JarvisHomeWidgetLayout {
  const normalized = normalizeJarvisHomeWidgetLayout(layout);
  if (movingId === targetId) return normalized;
  const order = normalized.order.filter((id) => id !== movingId);
  const targetIndex = order.indexOf(targetId);
  order.splice(targetIndex < 0 ? order.length : targetIndex, 0, movingId);
  return { ...normalized, order };
}

export function moveJarvisHomeWidget(
  layout: JarvisHomeWidgetLayout,
  id: JarvisHomeWidgetId,
  delta: -1 | 1,
): JarvisHomeWidgetLayout {
  const normalized = normalizeJarvisHomeWidgetLayout(layout);
  const index = normalized.order.indexOf(id);
  if (index < 0) return normalized;
  const target = Math.max(0, Math.min(normalized.order.length - 1, index + delta));
  if (target === index) return normalized;
  const order = [...normalized.order];
  order.splice(index, 1);
  order.splice(target, 0, id);
  return { ...normalized, order };
}

export function resizeJarvisHomeWidget(
  layout: JarvisHomeWidgetLayout,
  id: JarvisHomeWidgetId,
  size: JarvisHomeWidgetSize,
): JarvisHomeWidgetLayout {
  const normalized = normalizeJarvisHomeWidgetLayout(layout);
  return { ...normalized, sizes: { ...normalized.sizes, [id]: SIZES.has(size) ? size : "full" } };
}

export function setJarvisHomeWidgetHidden(
  layout: JarvisHomeWidgetLayout,
  id: JarvisHomeWidgetId,
  hidden: boolean,
): JarvisHomeWidgetLayout {
  const normalized = normalizeJarvisHomeWidgetLayout(layout);
  if (CRITICAL_IDS.has(id)) return { ...normalized, hidden: normalized.hidden.filter((item) => item !== id) };
  const next = new Set(normalized.hidden);
  if (hidden) next.add(id); else next.delete(id);
  return { ...normalized, hidden: normalized.order.filter((item) => next.has(item)) };
}

export function isCriticalJarvisHomeWidget(id: JarvisHomeWidgetId) {
  return CRITICAL_IDS.has(id);
}
