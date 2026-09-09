import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const switcherSource = new URL("../src/app/ControlCenterViewSwitcher.tsx", import.meta.url);
const layoutSource = new URL("../src/app/layout.tsx", import.meta.url);
const styleSource = new URL("../src/app/view-switcher.css", import.meta.url);

test("ダッシュボードとAI Chatを明示的に切り替えられる", async () => {
  const [switcher, layout, styles] = await Promise.all([
    readFile(switcherSource, "utf8"),
    readFile(layoutSource, "utf8"),
    readFile(styleSource, "utf8"),
  ]);

  assert.match(switcher, /ダッシュボード/);
  assert.match(switcher, /AI Chat/);
  assert.match(switcher, /view-dashboard/);
  assert.match(switcher, /view-chat/);
  assert.match(layout, /ControlCenterViewSwitcher/);
  assert.match(styles, /\.view-dashboard \.command-deck \{ display:none; \}/);
  assert.match(styles, /\.view-chat \.control-layout/);
  assert.match(styles, /\.view-chat \.quick-top-panel \{ display:none; \}/);
});
