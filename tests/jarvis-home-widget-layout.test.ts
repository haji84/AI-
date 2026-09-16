import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import {
  DEFAULT_JARVIS_HOME_WIDGET_LAYOUT,
  JARVIS_HOME_WIDGETS,
  moveJarvisHomeWidget,
  normalizeJarvisHomeWidgetLayout,
  reorderJarvisHomeWidget,
  resizeJarvisHomeWidget,
  setJarvisHomeWidgetHidden,
} from "../src/jarvis/home-widget-layout.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("malformed Home widget layout normalizes every known widget exactly once", () => {
  const layout = normalizeJarvisHomeWidgetLayout({
    order: ["remote-assist", "remote-assist", "unknown", "status"],
    hidden: ["quick-actions", "quick-actions", "human-takeover", "unknown"],
    sizes: { status: "giant", "remote-assist": "normal" },
  });
  const ids = JARVIS_HOME_WIDGETS.map((widget) => widget.id);
  assert.deepEqual(new Set(layout.order), new Set(ids));
  assert.equal(layout.order.length, ids.length);
  assert.deepEqual(layout.order.slice(0, 2), ["remote-assist", "status"]);
  assert.deepEqual(layout.hidden, ["quick-actions"]);
  assert.equal(layout.sizes.status, "full");
  assert.equal(layout.sizes["remote-assist"], "normal");
});

test("Home widgets support bounded reorder and movement", () => {
  const reordered = reorderJarvisHomeWidget(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT, "remote-assist", "status");
  assert.equal(reordered.order[0], "remote-assist");
  assert.equal(reordered.order[1], "status");

  const moved = moveJarvisHomeWidget(reordered, "status", 1);
  assert.equal(moved.order.indexOf("status"), 2);
  assert.equal(new Set(moved.order).size, JARVIS_HOME_WIDGETS.length);
});

test("Home widget size is bounded and ordinary widgets can hide and restore", () => {
  const resized = resizeJarvisHomeWidget(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT, "status", "wide");
  assert.equal(resized.sizes.status, "wide");

  const hidden = setJarvisHomeWidgetHidden(resized, "status", true);
  assert.ok(hidden.hidden.includes("status"));
  const restored = setJarvisHomeWidgetHidden(hidden, "status", false);
  assert.ok(!restored.hidden.includes("status"));
});

test("Human Takeover widget fails safe and cannot be hidden by persisted layout", () => {
  const hidden = setJarvisHomeWidgetHidden(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT, "human-takeover", true);
  assert.ok(!hidden.hidden.includes("human-takeover"));
  const normalized = normalizeJarvisHomeWidgetLayout({
    ...DEFAULT_JARVIS_HOME_WIDGET_LAYOUT,
    hidden: ["human-takeover"],
  });
  assert.ok(!normalized.hidden.includes("human-takeover"));
});

test("Home layout editor is browser-local and provides drag plus keyboard move controls", async () => {
  const editor = await source("src/app/jarvis/JarvisHomeLayoutEditor.tsx");
  assert.match(editor, /localStorage\.getItem\(JARVIS_HOME_WIDGET_LAYOUT_KEY\)/);
  assert.match(editor, /localStorage\.setItem\(JARVIS_HOME_WIDGET_LAYOUT_KEY/);
  assert.match(editor, /draggable/);
  assert.match(editor, /を上へ/);
  assert.match(editor, /を下へ/);
  assert.match(editor, /Human Takeoverは安全のため非表示にできない/);
  assert.doesNotMatch(editor, /fetch\(/);
  assert.doesNotMatch(editor, /\/api\//);
});
