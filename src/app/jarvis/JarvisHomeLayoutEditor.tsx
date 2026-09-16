"use client";

import { useCallback, useEffect, useState, type DragEvent } from "react";
import {
  DEFAULT_JARVIS_HOME_WIDGET_LAYOUT,
  isCriticalJarvisHomeWidget,
  JARVIS_HOME_WIDGET_LAYOUT_KEY,
  JARVIS_HOME_WIDGETS,
  moveJarvisHomeWidget,
  normalizeJarvisHomeWidgetLayout,
  reorderJarvisHomeWidget,
  resizeJarvisHomeWidget,
  setJarvisHomeWidgetHidden,
  type JarvisHomeWidgetId,
  type JarvisHomeWidgetLayout,
  type JarvisHomeWidgetSize,
} from "../../jarvis/home-widget-layout";

const SIZE_LABELS: Record<JarvisHomeWidgetSize, string> = {
  normal: "標準",
  wide: "ワイド",
  full: "全幅",
};

function findWidgetElement(root: HTMLElement, id: JarvisHomeWidgetId) {
  const definition = JARVIS_HOME_WIDGETS.find((widget) => widget.id === id);
  if (!definition) return null;
  const candidates = [...root.querySelectorAll<HTMLElement>(definition.selector)];
  const heading = "heading" in definition ? definition.heading : undefined;
  if (!heading) return candidates[0] ?? null;
  return candidates.find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === heading) ?? null;
}

function applyLayout(layout: JarvisHomeWidgetLayout) {
  const root = document.querySelector<HTMLElement>(".jarvis-console");
  if (!root) return;
  const normalized = normalizeJarvisHomeWidgetLayout(layout);
  root.classList.add("jarvis-widget-layout-enabled");

  const targets = new Set<HTMLElement>();
  normalized.order.forEach((id, index) => {
    const target = findWidgetElement(root, id);
    if (!target) return;
    targets.add(target);
    target.dataset.jarvisWidget = id;
    target.dataset.jarvisWidgetSize = normalized.sizes[id];
    target.style.order = String(index * 10);
    target.hidden = !isCriticalJarvisHomeWidget(id) && normalized.hidden.includes(id);
  });

  [...root.children].forEach((child, index) => {
    if (!(child instanceof HTMLElement) || targets.has(child)) return;
    if (child.classList.contains("jarvis-toolbar")) child.style.order = "-100";
    else if (child.classList.contains("jarvis-alert")) child.style.order = "-90";
    else if (child.classList.contains("jarvis-updated")) child.style.order = "1000";
    else child.style.order = String(900 + index);
  });
}

function readLayout() {
  try {
    const raw = window.localStorage.getItem(JARVIS_HOME_WIDGET_LAYOUT_KEY);
    return raw ? normalizeJarvisHomeWidgetLayout(JSON.parse(raw)) : normalizeJarvisHomeWidgetLayout(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT);
  } catch {
    return normalizeJarvisHomeWidgetLayout(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT);
  }
}

export default function JarvisHomeLayoutEditor() {
  const [layout, setLayout] = useState<JarvisHomeWidgetLayout>(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLayout(readLayout());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyLayout(layout);
    const root = document.querySelector<HTMLElement>(".jarvis-console");
    if (!root) return;
    const observer = new MutationObserver(() => applyLayout(layout));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [layout, ready]);

  const commit = useCallback((next: JarvisHomeWidgetLayout) => {
    const normalized = normalizeJarvisHomeWidgetLayout(next);
    setLayout(normalized);
    window.localStorage.setItem(JARVIS_HOME_WIDGET_LAYOUT_KEY, JSON.stringify(normalized));
    applyLayout(normalized);
  }, []);

  function drop(event: DragEvent<HTMLDivElement>, targetId: JarvisHomeWidgetId) {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/x-jarvis-widget");
    const moving = JARVIS_HOME_WIDGETS.find((widget) => widget.id === raw)?.id;
    if (moving) commit(reorderJarvisHomeWidget(layout, moving, targetId));
  }

  return (
    <details className="jarvis-widget-editor">
      <summary>ホーム配置を編集</summary>
      <div className="jarvis-widget-editor-body" aria-busy={!ready}>
        <p className="jarvis-boundary-note">ドラッグまたは上下ボタンで並び替え。サイズと表示状態はこのブラウザだけに保存される。Human Takeoverは安全のため非表示にできない。</p>
        <div className="jarvis-widget-editor-list">
          {layout.order.map((id, index) => {
            const definition = JARVIS_HOME_WIDGETS.find((widget) => widget.id === id)!;
            const critical = isCriticalJarvisHomeWidget(id);
            const hidden = layout.hidden.includes(id);
            return (
              <div
                className="jarvis-widget-editor-row"
                key={id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-jarvis-widget", id);
                }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                onDrop={(event) => drop(event, id)}
              >
                <div className="jarvis-widget-editor-name">
                  <span aria-hidden="true">↕</span>
                  <strong>{definition.label}</strong>
                  {critical && <small>常に表示</small>}
                  {hidden && <small>非表示</small>}
                </div>
                <div className="jarvis-widget-editor-actions">
                  <button type="button" className="button secondary" disabled={index === 0} onClick={() => commit(moveJarvisHomeWidget(layout, id, -1))} aria-label={`${definition.label}を上へ`}>↑</button>
                  <button type="button" className="button secondary" disabled={index === layout.order.length - 1} onClick={() => commit(moveJarvisHomeWidget(layout, id, 1))} aria-label={`${definition.label}を下へ`}>↓</button>
                  <label>
                    <span className="sr-only">{definition.label}のサイズ</span>
                    <select value={layout.sizes[id]} onChange={(event) => commit(resizeJarvisHomeWidget(layout, id, event.target.value as JarvisHomeWidgetSize))}>
                      {(Object.keys(SIZE_LABELS) as JarvisHomeWidgetSize[]).map((size) => <option key={size} value={size}>{SIZE_LABELS[size]}</option>)}
                    </select>
                  </label>
                  <button type="button" className="button secondary" disabled={critical} onClick={() => commit(setJarvisHomeWidgetHidden(layout, id, !hidden))}>{hidden ? "表示" : "隠す"}</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
