import assert from "node:assert/strict";
import test from "node:test";
import { JARVIS_THEMES, JARVIS_THEME_IDS, jarvisTheme } from "../src/app/jarvis/theme-catalog.ts";

test("GORIQ ships exactly 35 owner-distinct selectable screen designs", () => {
  assert.equal(JARVIS_THEME_IDS.length, 35);
  assert.equal(JARVIS_THEMES.length, 35);
  assert.equal(new Set(JARVIS_THEME_IDS).size, 35);
  assert.equal(JARVIS_THEMES.filter((item) => item.referenceSet === "A").length, 15);
  assert.equal(JARVIS_THEMES.filter((item) => item.referenceSet === "B").length, 20);
});

test("screen design catalog remains presentation metadata only", () => {
  for (const theme of JARVIS_THEMES) {
    assert.deepEqual(Object.keys(theme).sort(), ["backdrop","density","glow","id","label","mode","motionIntensity","radius","referenceSet"].sort());
  }
});

test("owner-distinct visual references may intentionally retain similar labels", () => {
  const cleanModern = JARVIS_THEMES.filter((item) => item.label === "クリーンモダン");
  const darkCinematic = JARVIS_THEMES.filter((item) => item.label === "ダークシネマティック");
  assert.equal(cleanModern.length, 2);
  assert.equal(darkCinematic.length, 2);
  assert.notEqual(cleanModern[0]?.id, cleanModern[1]?.id);
  assert.notEqual(darkCinematic[0]?.id, darkCinematic[1]?.id);
});

test("unknown screen design safely falls back to clean modern", () => {
  assert.equal(jarvisTheme("does-not-exist").id, "clean-modern");
});
