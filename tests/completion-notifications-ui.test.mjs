import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('owner notification view exposes operation, target, deadline and impact without approval controls', async () => {
  const root = path.resolve('.jarvis'); fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'completion-ui-'));
  const file = path.join(dir, 'view.mjs');
  try {
    const output = ts.transpileModule(fs.readFileSync('src/app/jarvis/tasks/GoalBridgeStatus.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    fs.writeFileSync(file, output);
    const module = await import(pathToFileURL(file).href);
    assert.equal(typeof module.CompletionDetails, 'function', 'existing owner status needs the completion notification view');
    const html = renderToStaticMarkup(createElement(module.CompletionDetails, { completion: { readyForCompletionReview: false, verifiedCriteria: ['software'], remainingCriteria: ['physical'], replanRequired: true,
      recommendation: { taskId: 'inspect', reasons: ['requires evidence'] }, notifications: [{ id: 'notice1', taskId: 'phone', status: 'PREPARED', operation: '画面共有を許可', reason: '本人同意が必要', target: 'nubia', deadline: '2026-10-23T12:00:00Z', impact: '実機試験は待機', preparedAt: '2026-10-23T11:00:00Z' }] } }));
    for (const text of ['画面共有を許可', '本人同意が必要', 'nubia', '2026-10-23T12:00:00Z', '実機試験は待機', '未完了', '再計画']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('<button'), 'notification display never grants approval');
    assert.ok(html.includes('data-notification-id="notice1"'));
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); }
});
