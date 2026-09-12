import assert from "node:assert/strict";
import test from "node:test";
import { classifyQaScreen } from "../src/jarvis/qa-sequence.ts";

test("error screen wins and is marked no-retry candidate", () => {
  const result = classifyQaScreen(`
    <hierarchy>
      <node text="お友達のお手伝いが出来ませんでした" />
      <node text="あなたのアカウントでエラーが発生しました。別のアカウントでお試しください。" />
      <node text="参加する" />
    </hierarchy>
  `);
  assert.equal(result.state, "error");
  assert.ok(result.matched.some((value) => value.includes("お友達のお手伝い")));
});

test("step1 success requires the supplied green-state markers", () => {
  const result = classifyQaScreen(`
    <hierarchy>
      <node text="イベント詳細" />
      <node text="新規ユーザー" />
      <node text="30日以上アプリを使っていない人" />
      <node text="今日アプリを使っていない人" />
      <node text="その他の既存ユーザー" />
    </hierarchy>
  `);
  assert.equal(result.state, "step1-success");
});

test("generic event screen is not enough for step1 success", () => {
  const result = classifyQaScreen(`
    <hierarchy>
      <node text="イベント詳細" />
      <node text="獲得履歴" />
      <node text="イベントルール" />
    </hierarchy>
  `);
  assert.equal(result.state, "pending");
});

test("step2 success requires receipt confirmation and QR action", () => {
  const result = classifyQaScreen(`
    <hierarchy>
      <node text="友だち @user が受け取りました" />
      <node text="10円分" />
      <node text="マイQRコードを表示" />
    </hierarchy>
  `);
  assert.equal(result.state, "step2-success");
});

test("unrecognized screen remains pending", () => {
  const result = classifyQaScreen(`<hierarchy><node text="読み込み中" /></hierarchy>`);
  assert.equal(result.state, "pending");
});
