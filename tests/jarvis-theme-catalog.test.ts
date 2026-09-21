import assert from "node:assert/strict";
import test from "node:test";
import { JARVIS_THEMES, JARVIS_THEME_IDS, jarvisTheme } from "../src/app/jarvis/theme-catalog.ts";

test("JARVIS ships exactly 20 selectable presentation themes", () => {
  assert.equal(JARVIS_THEME_IDS.length, 20);
  assert.equal(JARVIS_THEMES.length, 20);
  assert.equal(new Set(JARVIS_THEME_IDS).size, 20);
  assert.equal(new Set(JARVIS_THEMES.map((item) => item.label)).size, 20);
});

test("theme catalog is presentation metadata only", () => {
  for (const theme of JARVIS_THEMES) {
    assert.deepEqual(Object.keys(theme).sort(), ["backdrop","density","glow","id","label","mode","motionIntensity","radius"].sort());
  }
});

test("unknown theme safely falls back to clean modern", () => {
  assert.equal(jarvisTheme("does-not-exist").id, "clean-modern");
});
