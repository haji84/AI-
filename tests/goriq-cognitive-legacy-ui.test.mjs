import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function component(name) {
  const filename = resolve("src/app/jarvis/tasks", name + ".tsx");
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const initialize = new Script("(function(exports,require,module,__filename,__dirname){\n" + compiled + "\n})", { filename }).runInThisContext();
  initialize(module.exports, createRequire(filename), module, filename, dirname(filename));
  return module.exports.default;
}
const CognitiveLearning = component("CognitiveLearning");
const CognitiveMaterials = component("CognitiveMaterials");
const legacySnapshot = {
  goalId: "goal-0123456789abcdef", goalTitle: "Existing Goal", busy: false, goalComplete: false,
  mode: "READY", attempts: 0, nextAction: null, blockers: [], externalAIEnabled: false,
  recentAttempts: [], localActionsConfigured: false,
  metrics: { goals: 0, completedGoals: 0, externalAiFreeCompletionRate: null, externalAiCallsPerGoal: null },
};
const render = (Component, state) => renderToStaticMarkup(createElement(Component, { state, disabled: false, onSaved: async () => {} }));

test("legacy Broker status renders a learning fallback without new action controls", () => {
  const html = render(CognitiveLearning, legacySnapshot);
  assert.match(html, /現在のGoal操作は引き続き利用できます/);
  assert.doesNotMatch(html, /<button|<select|<input|設定済みの履歴を取り込む/);
});

test("legacy Broker status does not expose unsupported material intake controls", () => {
  assert.equal(render(CognitiveMaterials, legacySnapshot), "");
});

test("current Broker status renders learning counts and keeps unsupported import disabled", () => {
  const html = render(CognitiveLearning, { ...legacySnapshot, historyImportEnabled: false,
    history: { total: 3, unverified: 3, verified: 0, sourceKinds: { decision: 3 } } });
  assert.match(html, /保存した履歴候補 3件（未検証 3件）/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>設定済みの履歴を取り込む<\/button>/);
  assert.match(html, /学習候補を確認/);
  assert.doesNotMatch(html, /まだ対応していません/);
});
