import assert from "node:assert/strict";
import test from "node:test";

import { JARVIS_THEME_IDS, JARVIS_THEMES } from "../src/app/jarvis/theme-catalog.ts";
import {
  JARVIS_PRIMARY_SCREENS,
  normalizeJarvisScreenLayoutProfiles,
} from "../src/app/jarvis/screen-layout-profiles.ts";

test("owner screen-design catalog exposes exactly 35 distinct presets", () => {
  assert.equal(JARVIS_THEME_IDS.length, 35);
  assert.equal(new Set(JARVIS_THEME_IDS).size, 35);
  assert.equal(JARVIS_THEMES.length, 35);
  assert.equal(JARVIS_THEMES.filter((theme) => theme.referenceSet === "A").length, 15);
  assert.equal(JARVIS_THEMES.filter((theme) => theme.referenceSet === "B").length, 20);
});

test("screen design catalog keeps all owner-provided duplicate concepts as distinct slots", () => {
  const cleanModern = JARVIS_THEMES.filter((theme) => theme.label === "クリーンモダン");
  const darkCinematic = JARVIS_THEMES.filter((theme) => theme.label === "ダークシネマティック");
  assert.equal(cleanModern.length, 2);
  assert.equal(darkCinematic.length, 2);
  assert.notEqual(cleanModern[0]?.id, cleanModern[1]?.id);
  assert.notEqual(darkCinematic[0]?.id, darkCinematic[1]?.id);
});

test("layout normalization covers every primary screen including new development and decisions", () => {
  const normalized = normalizeJarvisScreenLayoutProfiles({ home: "focus", decisions: "mobile" });
  const ids = JARVIS_PRIMARY_SCREENS.map(([id]) => id);
  assert.ok(ids.includes("newDevelopment"));
  assert.ok(ids.includes("decisions"));
  assert.equal(normalized.home, "focus");
  assert.equal(normalized.decisions, "mobile");
  assert.equal(normalized.newDevelopment, "inherit");
});
