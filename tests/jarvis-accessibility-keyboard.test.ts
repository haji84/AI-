import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../src/app/jarvis/JarvisPrimaryShell.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/jarvis/accessibility.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/jarvis/layout.tsx", import.meta.url), "utf8");
const operationControls = readFileSync(new URL("../src/app/jarvis/JarvisOperationModeControls.tsx", import.meta.url), "utf8");

test("primary shell exposes a keyboard skip path to a semantic main landmark", () => {
  assert.match(shell, /className="jarvis-skip-link" href="#jarvis-main-content">本文へ移動<\/a>/);
  assert.match(shell, /<main id="jarvis-main-content" className="jarvis-primary-content" tabIndex=\{-1\}>/);
  assert.match(shell, /<nav className="jarvis-primary-nav" aria-label="JARVIS メインナビゲーション">/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
});

test("keyboard focus is visibly distinct and native controls remain keyboard operable", () => {
  assert.match(css, /\.jarvis-skip-link:focus-visible/);
  assert.match(css, /:where\(a,button,input,select,textarea,\[tabindex\]\):focus-visible/);
  assert.match(css, /outline:3px solid #8fefff/);
  assert.match(operationControls, /<button/);
  assert.match(operationControls, /aria-pressed=\{mode === id\}/);
  assert.doesNotMatch(operationControls, /tabIndex=\{-1\}/);
});

test("OS reduced-motion preference disables nonessential JARVIS motion", () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /animation-duration:\.001ms!important/);
  assert.match(css, /transition-duration:\.001ms!important/);
  assert.match(css, /scroll-behavior:auto!important/);
});

test("accessibility stylesheet is product scoped and loaded by the JARVIS layout", () => {
  assert.match(layout, /import "\.\/accessibility\.css";/);
  assert.match(css, /\.jarvis-primary-shell/);
  assert.doesNotMatch(css, /display:none/);
  assert.doesNotMatch(css, /pointer-events:none/);
});
