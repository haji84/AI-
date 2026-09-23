import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isJarvisReadOnlyMode,
  isSafeJarvisReadOnlyHref,
  JARVIS_OPERATION_MODES,
  normalizeJarvisOperationMode,
} from "../src/app/jarvis/operation-mode.ts";

const boundary = readFileSync(new URL("../src/app/jarvis/JarvisReadOnlyBoundary.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("../src/app/jarvis/JarvisOperationModeControls.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/app/jarvis/JarvisPrimaryShell.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/jarvis/operation-mode.css", import.meta.url), "utf8");

test("operation mode normalization fails safe to standard", () => {
  assert.deepEqual(JARVIS_OPERATION_MODES.map(([id]) => id), ["standard", "read-only", "kiosk"]);
  assert.equal(normalizeJarvisOperationMode("read-only"), "read-only");
  assert.equal(normalizeJarvisOperationMode("kiosk"), "kiosk");
  assert.equal(normalizeJarvisOperationMode("admin"), "standard");
  assert.equal(normalizeJarvisOperationMode(null), "standard");
  assert.equal(isJarvisReadOnlyMode("standard"), false);
  assert.equal(isJarvisReadOnlyMode("read-only"), true);
  assert.equal(isJarvisReadOnlyMode("kiosk"), true);
});

test("readonly navigation permits JARVIS inspection but rejects action and external links", () => {
  assert.equal(isSafeJarvisReadOnlyHref("/jarvis"), true);
  assert.equal(isSafeJarvisReadOnlyHref("/jarvis/tasks"), true);
  assert.equal(isSafeJarvisReadOnlyHref("/jarvis/login?next=/jarvis"), true);
  assert.equal(isSafeJarvisReadOnlyHref("/"), true);
  assert.equal(isSafeJarvisReadOnlyHref("jarvis://enroll/token"), false);
  assert.equal(isSafeJarvisReadOnlyHref("https://example.com"), false);
  assert.equal(isSafeJarvisReadOnlyHref("javascript:alert(1)"), false);
});

test("readonly boundary blocks mutation surfaces without pretending to be backend authorization", () => {
  assert.match(boundary, /onSubmitCapture=\{blockSubmit\}/);
  for (const event of ["onDragStartCapture", "onDragOverCapture", "onDropCapture"]) {
    assert.ok(boundary.includes(event + "={blockSubmit}"), "read-only mode must block " + event);
  }
  assert.match(boundary, /onPointerDownCapture=\{blockRemotePointer\}/);
  assert.match(boundary, /button,input,select,textarea/);
  assert.match(boundary, /\.jarvis-remote-screen,\.jarvis-multiview-shot/);
  assert.match(boundary, /変更操作・遠隔入力・外部アクションは停止中/);
  assert.doesNotMatch(boundary, /fetch\(/);
});

test("kiosk keeps a local exit control and does not hide safety alerts", () => {
  assert.match(shell, /<JarvisOperationModeControls \/>/);
  assert.match(controls, /JARVIS_OPERATION_MODES\.map/);
  assert.match(controls, /choose\(id\)/);
  assert.match(css, /data-jarvis-operation-mode="kiosk"[^\n]*\.jarvis-primary-nav/);
  assert.match(css, /data-jarvis-operation-mode="kiosk"[^\n]*\.jarvis-owner-link/);
  assert.doesNotMatch(css, /data-jarvis-operation-mode="kiosk"[^\n]*(\.jarvis-alert|\.jarvis-takeover)[^\n]*display:none/);
});
