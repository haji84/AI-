import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandChatSource = new URL("../src/app/CommandChat.tsx", import.meta.url);

test("AI司令チャットの結果確認ボタンは実行結果が分かる文言を使う", async () => {
  const source = await readFile(commandChatSource, "utf8");

  assert.match(source, /最新の実行結果を見る/);
  assert.doesNotMatch(source, /\{checking \? "確認中…" : "最新結果を確認"\}/);
});
