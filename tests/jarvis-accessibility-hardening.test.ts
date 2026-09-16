import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../src/app/jarvis/JarvisPrimaryShell.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/jarvis/accessibility-status.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/jarvis/layout.tsx", import.meta.url), "utf8");

test("JARVIS exposes a skip path to a semantic main landmark", () => {
  assert.match(shell, /className="jarvis-skip-link" href="#jarvis-main-content"/);
  assert.match(shell, /<main id="jarvis-main-content" className="jarvis-primary-content" tabIndex=\{-1\}>/);
  assert.match(shell, /<nav className="jarvis-primary-nav" aria-label="JARVIS メインナビゲーション">/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
});

test("JARVIS keeps keyboard focus visible without disabling interaction", () => {
  assert.match(css, /:where\(a,button,input,select,textarea,summary,\[tabindex\]\):focus-visible/);
  assert.match(css, /outline:3px solid var\(--jarvis-accent/);
  assert.doesNotMatch(css, /pointer-events:none/);
});

test("OS reduced-motion preference suppresses nonessential shell motion", () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /animation-duration:\.001ms!important/);
  assert.match(css, /animation-iteration-count:1!important/);
  assert.match(css, /transition-duration:\.001ms!important/);
  assert.match(css, /scroll-behavior:auto!important/);
});

test("accessibility stylesheet stays loaded by the JARVIS layout", () => {
  assert.match(layout, /import "\.\/accessibility-status\.css";/);
});
