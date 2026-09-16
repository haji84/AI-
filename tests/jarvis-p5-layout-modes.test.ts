import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JARVIS_LAYOUTS } from "../src/app/jarvis/ui-preferences.ts";

const preferences = readFileSync(new URL("../src/app/jarvis/ui-preferences.ts", import.meta.url), "utf8");
const layoutModes = readFileSync(new URL("../src/app/jarvis/layout-modes.css", import.meta.url), "utf8");
const screenProfiles = readFileSync(new URL("../src/app/jarvis/screen-layout-profiles.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/app/jarvis/shell.css", import.meta.url), "utf8");
const jarvis = readFileSync(new URL("../src/app/jarvis/jarvis.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/jarvis/layout.tsx", import.meta.url), "utf8");

test("global P5 layout preferences have effective CSS for every declared mode", () => {
  assert.deepEqual(JARVIS_LAYOUTS.map(([id]) => id), ["command", "balanced", "focus", "mobile"]);
  assert.match(preferences, /root\.dataset\.jarvisLayout = normalized\.layout/);
  for (const [id] of JARVIS_LAYOUTS) {
    assert.ok(layoutModes.includes(`data-jarvis-layout="${id}"`), `missing CSS for ${id}`);
  }
  assert.match(layout, /import "\.\/layout-modes\.css";/);
});

test("per-screen layout remains authoritative over the common layout", () => {
  assert.match(layoutModes, /data-jarvis-layout="command"\]:not\(\[data-jarvis-screen-layout\]\)/);
  assert.match(layoutModes, /data-jarvis-layout="balanced"\]:not\(\[data-jarvis-screen-layout\]\)/);
  assert.match(layoutModes, /data-jarvis-layout="focus"\]:not\(\[data-jarvis-screen-layout\]\)/);
  assert.match(layoutModes, /data-jarvis-layout="mobile"\]:not\(\[data-jarvis-screen-layout\]\)/);
  assert.match(screenProfiles, /data-jarvis-screen-layout="command"/);
  assert.match(screenProfiles, /data-jarvis-screen-layout="balanced"/);
  assert.match(screenProfiles, /data-jarvis-screen-layout="focus"/);
  assert.match(screenProfiles, /data-jarvis-screen-layout="mobile"/);
  assert.ok(layout.indexOf("layout-modes.css") < layout.indexOf("screen-layout-profiles.css"));
});

test("Mobile Mode is usable on a wide display without waiting for a media query", () => {
  assert.match(layoutModes, /data-jarvis-layout="mobile"[^\n]*\.jarvis-screen-page\{max-width:720px\}/);
  assert.match(layoutModes, /\.jarvis-info-grid,.jarvis-grid,.jarvis-remote-layout,.jarvis-task-form/);
  assert.match(layoutModes, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(layoutModes, /\.jarvis-primary-nav\{justify-content:flex-start;overflow-x:auto\}/);
  assert.match(layoutModes, /\.jarvis-screen-heading\{align-items:stretch;flex-direction:column\}/);
});

test("Adaptive Layout retains responsive breakpoints independently of stored preference", () => {
  assert.match(shell, /@media\(max-width:900px\)/);
  assert.match(shell, /@media\(max-width:560px\)/);
  assert.match(jarvis, /@media\(max-width:900px\)/);
  assert.match(jarvis, /@media\(max-width:560px\)/);
  assert.match(layoutModes, /@media\(max-width:900px\)/);
  assert.match(layoutModes, /width:100%;box-sizing:border-box/);
  assert.doesNotMatch(preferences, /fetch\(/);
});
