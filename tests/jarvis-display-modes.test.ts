import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JARVIS_DISPLAY_MODES, normalizeJarvisDisplayMode } from "../src/app/jarvis/display-modes.ts";

const css = readFileSync(new URL("../src/app/jarvis/jarvis.css", import.meta.url), "utf8");
const controls = readFileSync(new URL("../src/app/jarvis/JarvisDisplayModeControls.tsx", import.meta.url), "utf8");

test("display mode normalization accepts only the four declared safe modes", () => {
  assert.deepEqual(JARVIS_DISPLAY_MODES.map(([id]) => id), ["standard", "focus", "distance", "privacy"]);
  for (const [id] of JARVIS_DISPLAY_MODES) assert.equal(normalizeJarvisDisplayMode(id), id);
  assert.equal(normalizeJarvisDisplayMode("admin"), "standard");
  assert.equal(normalizeJarvisDisplayMode(null), "standard");
  assert.equal(normalizeJarvisDisplayMode({ mode: "privacy" }), "standard");
});

test("privacy mode blacks out remote screens, fleet previews, and enrollment tokens", () => {
  assert.match(css, /data-jarvis-display-mode="privacy"[^}]*\.jarvis-remote-screen/);
  assert.match(css, /data-jarvis-display-mode="privacy"[^}]*\.jarvis-multiview-shot/);
  assert.match(css, /data-jarvis-display-mode="privacy"[^}]*\.jarvis-enrollment-result code/);
  assert.match(css, /content:"PRIVACY MODE"/);
});

test("focus mode never hides Human Takeover safety surfaces", () => {
  const focusRules = css.match(/html\[data-jarvis-display-mode="focus"\][^}]+}/g) ?? [];
  assert.ok(focusRules.length > 0);
  assert.equal(focusRules.some((rule) => rule.includes("jarvis-takeover")), false);
  assert.equal(focusRules.some((rule) => rule.includes("jarvis-alert")), false);
});

test("distance mode uses calibrated 3-5m variables and enlarges interactive controls", () => {
  assert.match(css, /data-jarvis-display-mode="distance"\]\{font-size:calc\(100% \* var\(--jarvis-distance-font-scale,1\.18\)\)/);
  assert.match(css, /data-jarvis-display-mode="distance"\][^}]*button/);
  assert.match(css, /min-height:var\(--jarvis-distance-target-px,56px\)/);
  assert.match(controls, /約3m/);
  assert.match(controls, /約4m/);
  assert.match(controls, /約5m/);
});

test("display controls expose native keyboard buttons and pressed state", () => {
  assert.match(controls, /<button/);
  assert.match(controls, /aria-pressed=\{mode === id\}/);
  assert.match(controls, /aria-live="polite"/);
});
