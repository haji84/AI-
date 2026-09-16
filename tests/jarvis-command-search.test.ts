import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { JARVIS_COMMAND_SEARCH_ITEMS, searchJarvisCommands } from "../src/jarvis/command-search.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("command search catalog is bounded to unique internal JARVIS navigation destinations", () => {
  assert.equal(JARVIS_COMMAND_SEARCH_ITEMS.length, 7);
  assert.equal(new Set(JARVIS_COMMAND_SEARCH_ITEMS.map((item) => item.id)).size, JARVIS_COMMAND_SEARCH_ITEMS.length);
  assert.equal(new Set(JARVIS_COMMAND_SEARCH_ITEMS.map((item) => item.href)).size, JARVIS_COMMAND_SEARCH_ITEMS.length);
  for (const item of JARVIS_COMMAND_SEARCH_ITEMS) {
    assert.match(item.href, /^\/jarvis(?:\/|$)/);
    assert.notEqual(item.href, "/jarvis/login");
  }
});

test("command search matches Japanese and bounded aliases with stable ranking", () => {
  assert.equal(searchJarvisCommands("端末")[0]?.id, "devices");
  assert.equal(searchJarvisCommands("recording")[0]?.id, "recordings");
  assert.equal(searchJarvisCommands("テーマ")[0]?.id, "settings");
  assert.deepEqual(searchJarvisCommands("存在しない画面"), []);
  assert.equal(searchJarvisCommands("", 3).length, 3);
});

test("command search UI provides keyboard navigation without protected mutation paths", async () => {
  const component = await source("src/app/jarvis/JarvisCommandSearch.tsx");
  const shell = await source("src/app/jarvis/JarvisPrimaryShell.tsx");
  const layout = await source("src/app/jarvis/layout.tsx");

  assert.match(component, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(component, /event\.key === "\/"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /event\.key === "Enter"/);
  assert.match(component, /window\.location\.assign\(results\[0\]\.href\)/);
  assert.match(component, /aria-label="JARVIS コマンドと画面を検索"/);
  assert.match(component, /端末操作・承認・権限変更は各画面の既存Human Gateを通ります/);
  assert.doesNotMatch(component, /fetch\(/);
  assert.doesNotMatch(component, /\/api\//);
  assert.match(shell, /<JarvisCommandSearch pathname=\{pathname\} \/>/);
  assert.match(shell, /pathname\.startsWith\("\/jarvis\/login"\)/);
  assert.match(layout, /import "\.\/command-search\.css"/);
});
