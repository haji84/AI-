import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import {
  createJarvisHomeLayoutHistory,
  JARVIS_HOME_LAYOUT_HISTORY_LIMIT,
  pushJarvisHomeLayoutHistory,
  redoJarvisHomeLayoutHistory,
  undoJarvisHomeLayoutHistory,
} from "../src/jarvis/home-widget-history.ts";
import {
  DEFAULT_JARVIS_HOME_WIDGET_LAYOUT,
  getJarvisHomeLayoutPreset,
  JARVIS_HOME_LAYOUT_PRESETS,
  JARVIS_HOME_WIDGETS,
  moveJarvisHomeWidget,
  type JarvisHomeLayoutPresetId,
} from "../src/jarvis/home-widget-layout.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Home layout presets are deterministic, complete and keep Human Takeover visible", () => {
  assert.deepEqual(JARVIS_HOME_LAYOUT_PRESETS.map((preset) => preset.id), ["standard", "dashboard", "remote-assist"]);
  const allIds = new Set(JARVIS_HOME_WIDGETS.map((widget) => widget.id));
  for (const preset of JARVIS_HOME_LAYOUT_PRESETS) {
    const layout = getJarvisHomeLayoutPreset(preset.id as JarvisHomeLayoutPresetId);
    assert.equal(layout.order.length, allIds.size);
    assert.deepEqual(new Set(layout.order), allIds);
    assert.ok(!layout.hidden.includes("human-takeover"));
  }
  assert.equal(getJarvisHomeLayoutPreset("remote-assist").order[0], "remote-assist");
});

test("Home layout history supports Undo and Redo", () => {
  const initial = createJarvisHomeLayoutHistory(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT);
  const moved = moveJarvisHomeWidget(initial.present, "remote-assist", -1);
  const changed = pushJarvisHomeLayoutHistory(initial, moved);
  assert.equal(changed.past.length, 1);
  assert.equal(changed.future.length, 0);
  assert.notDeepEqual(changed.present.order, initial.present.order);

  const undone = undoJarvisHomeLayoutHistory(changed);
  assert.deepEqual(undone.present, initial.present);
  assert.equal(undone.future.length, 1);

  const redone = redoJarvisHomeLayoutHistory(undone);
  assert.deepEqual(redone.present, changed.present);
  assert.equal(redone.future.length, 0);
});

test("new change after Undo clears Redo history", () => {
  const initial = createJarvisHomeLayoutHistory(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT);
  const first = pushJarvisHomeLayoutHistory(initial, getJarvisHomeLayoutPreset("dashboard"));
  const second = pushJarvisHomeLayoutHistory(first, getJarvisHomeLayoutPreset("remote-assist"));
  const undone = undoJarvisHomeLayoutHistory(second);
  assert.equal(undone.future.length, 1);
  const branched = pushJarvisHomeLayoutHistory(undone, getJarvisHomeLayoutPreset("standard"));
  assert.equal(branched.future.length, 0);
});

test("Home layout history stays bounded", () => {
  let history = createJarvisHomeLayoutHistory(DEFAULT_JARVIS_HOME_WIDGET_LAYOUT);
  for (let index = 0; index < JARVIS_HOME_LAYOUT_HISTORY_LIMIT + 8; index += 1) {
    const preset = index % 2 === 0 ? getJarvisHomeLayoutPreset("dashboard") : getJarvisHomeLayoutPreset("remote-assist");
    history = pushJarvisHomeLayoutHistory(history, preset);
  }
  assert.equal(history.past.length, JARVIS_HOME_LAYOUT_HISTORY_LIMIT);
});

test("Home layout editor exposes presets Undo Redo and safe reset without network mutation", async () => {
  const editor = await source("src/app/jarvis/JarvisHomeLayoutEditor.tsx");
  assert.match(editor, /JARVIS_HOME_LAYOUT_PRESETS/);
  assert.match(editor, /元に戻す/);
  assert.match(editor, /やり直す/);
  assert.match(editor, /初期配置へ戻す/);
  assert.match(editor, /DEFAULT_JARVIS_HOME_WIDGET_LAYOUT/);
  assert.doesNotMatch(editor, /fetch\(/);
  assert.doesNotMatch(editor, /\/api\//);
});
