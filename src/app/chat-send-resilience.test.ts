import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const conversationsRoute = new URL("./api/conversations/route.ts", import.meta.url);
const commandRoute = new URL("./api/command/route.ts", import.meta.url);

test("owner message falls back to a new pending continuation issue when PATCH is forbidden", async () => {
  const source = await readFile(conversationsRoute, "utf8");
  assert.match(source, /createPendingContinuation/);
  assert.match(source, /withPendingOwnerFallback\(currentMeta, message\)/);
  assert.match(source, /storage: "continuation_issue_fallback"/);
  assert.match(source, /continuation-of:/);
});

test("non-owner auxiliary persistence failures do not roll back an accepted owner request", async () => {
  const source = await readFile(conversationsRoute, "utf8");
  assert.match(source, /storage: "skipped"/);
  assert.match(source, /storage: comment\.ok \? "best_effort_comment" : "skipped"/);
});

test("repository_dispatch failure remains accepted when the durable conversation bridge exists", async () => {
  const source = await readFile(commandRoute, "utf8");
  assert.match(source, /if \(numericConversationId\)/);
  assert.match(source, /dispatchAccepted: false/);
  assert.match(source, /ChatGPT共有ブリッジへの会話保存を優先して受け付けました/);
});
