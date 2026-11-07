import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

test("existing Settings renders a guarded Japanese local backup panel with truthful coverage and isolated verification", async () => {
  const componentUrl = new URL("../src/app/jarvis/settings/JarvisStateBackupSettings.tsx", import.meta.url);
  assert.ok(existsSync(componentUrl), "Settings has no real state backup panel");
  const source = await readFile(componentUrl, "utf8");
  const require = createRequire(import.meta.url);
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from "react"/g, `from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)}`)
    .replace(/from "react\/jsx-runtime"/g, `from ${JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)}`)
    .replace(/from "\.\.\/operation-mode"/g, `from ${JSON.stringify(new URL("../src/app/jarvis/operation-mode.ts", import.meta.url).href)}`);
  const { default: Panel } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
  const html = renderToStaticMarkup(React.createElement(Panel));
  assert.match(html, /ローカル.*バックアップ/);
  assert.match(html, /復元を検証/); assert.match(html, /PC.*JSON/); assert.match(html, /同一時点/); assert.match(html, /Human Gate/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /type="file"|type="password"|name="path"/);
  const page = await readFile(new URL("../src/app/jarvis/settings/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<JarvisStateBackupSettings\s*\/>/);
  assert.match(source, /readJarvisOperationMode/); assert.match(source, /isJarvisReadOnlyMode/);
  assert.match(source, /jarvis-operation-mode-changed/);
  assert.match(source, /\/api\/jarvis\/state-backups/);
  assert.doesNotMatch(source, /localStorage\.setItem|console\.(?:log|error)|dangerouslySetInnerHTML/);
});
/* global Buffer, URL */
