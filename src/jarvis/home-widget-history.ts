import {
  normalizeJarvisHomeWidgetLayout,
  type JarvisHomeWidgetLayout,
} from "./home-widget-layout.ts";

export const JARVIS_HOME_LAYOUT_HISTORY_LIMIT = 30;

export type JarvisHomeLayoutHistory = {
  past: JarvisHomeWidgetLayout[];
  present: JarvisHomeWidgetLayout;
  future: JarvisHomeWidgetLayout[];
};

function sameLayout(a: JarvisHomeWidgetLayout, b: JarvisHomeWidgetLayout) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createJarvisHomeLayoutHistory(layout: JarvisHomeWidgetLayout): JarvisHomeLayoutHistory {
  return {
    past: [],
    present: normalizeJarvisHomeWidgetLayout(layout),
    future: [],
  };
}

export function pushJarvisHomeLayoutHistory(
  history: JarvisHomeLayoutHistory,
  nextLayout: JarvisHomeWidgetLayout,
): JarvisHomeLayoutHistory {
  const present = normalizeJarvisHomeWidgetLayout(history.present);
  const next = normalizeJarvisHomeWidgetLayout(nextLayout);
  if (sameLayout(present, next)) return { ...history, present };
  return {
    past: [...history.past, present].slice(-JARVIS_HOME_LAYOUT_HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function undoJarvisHomeLayoutHistory(history: JarvisHomeLayoutHistory): JarvisHomeLayoutHistory {
  if (history.past.length === 0) return history;
  const previous = normalizeJarvisHomeWidgetLayout(history.past[history.past.length - 1]);
  const present = normalizeJarvisHomeWidgetLayout(history.present);
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [present, ...history.future].slice(0, JARVIS_HOME_LAYOUT_HISTORY_LIMIT),
  };
}

export function redoJarvisHomeLayoutHistory(history: JarvisHomeLayoutHistory): JarvisHomeLayoutHistory {
  if (history.future.length === 0) return history;
  const present = normalizeJarvisHomeWidgetLayout(history.present);
  const next = normalizeJarvisHomeWidgetLayout(history.future[0]);
  return {
    past: [...history.past, present].slice(-JARVIS_HOME_LAYOUT_HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  };
}
