import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JARVIS_DISPLAY_MODES, normalizeJarvisDisplayMode } from "../src/app/jarvis/display-modes.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${repoRoot}/${path}`, "utf8");

test("SEC-017 privacy mode is explicit and unknown modes fail to standard", () => {
  assert.ok(JARVIS_DISPLAY_MODES.some(([id]) => id === "privacy"));
  assert.equal(normalizeJarvisDisplayMode("privacy"), "privacy");
  assert.equal(normalizeJarvisDisplayMode("privacy-admin"), "standard");
  assert.equal(normalizeJarvisDisplayMode({ mode: "privacy" }), "standard");
});

test("SEC-017 all current sensitive visual surfaces use a privacy blackout selector", () => {
  const css = read("src/app/jarvis/jarvis.css");
  for (const selector of [
    ".jarvis-remote-screen",
    ".jarvis-multiview-shot",
    ".jarvis-enrollment-result code",
  ]) {
    assert.match(css, new RegExp(`data-jarvis-display-mode=\\"privacy\\"[^}]*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.match(css, /data-jarvis-display-mode="privacy"[\s\S]*content:"PRIVACY MODE"/);
  assert.match(css, /data-jarvis-display-mode="privacy"[\s\S]*visibility:hidden!important/);
});

test("SEC-017 live RemoteVideo canvas is inside the protected remote-screen blackout surface", () => {
  const video = read("src/app/jarvis/RemoteVideo.tsx");
  assert.match(video, /className="jarvis-remote-screen jarvis-remote-video-screen"[\s\S]*<canvas/);
});

test("SEC-017 privacy blackout does not hide Human Takeover or alert safety surfaces", () => {
  const css = read("src/app/jarvis/jarvis.css");
  const privacyRules = css.match(/html\[data-jarvis-display-mode="privacy"\][^}]+}/g) ?? [];
  assert.ok(privacyRules.length > 0);
  assert.equal(privacyRules.some((rule) => rule.includes("jarvis-takeover")), false);
  assert.equal(privacyRules.some((rule) => rule.includes("jarvis-alert")), false);
});
