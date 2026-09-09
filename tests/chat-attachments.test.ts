import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatSource = new URL("../src/app/CommandChat.tsx", import.meta.url);
const attachmentRouteSource = new URL("../src/app/api/attachments/route.ts", import.meta.url);
const commandRouteSource = new URL("../src/app/api/command/route.ts", import.meta.url);

test("AI Chatは複数の写真・動画・ファイルを直接Blobへ添付できる", async () => {
  const [chat, attachmentRoute, commandRoute] = await Promise.all([
    readFile(chatSource, "utf8"),
    readFile(attachmentRouteSource, "utf8"),
    readFile(commandRouteSource, "utf8"),
  ]);

  assert.match(chat, /＋ 添付/);
  assert.match(chat, /type="file"/);
  assert.match(chat, /multiple/);
  assert.match(chat, /action: "prepare"/);
  assert.match(chat, /method: "PUT"/);
  assert.match(chat, /action: "authorize-read"/);
  assert.match(chat, /attachments/);
  assert.match(attachmentRoute, /x-vercel-blob-access/);
  assert.match(attachmentRoute, /private/);
  assert.match(commandRoute, /attachments\.length > 0/);
  assert.match(commandRoute, /reasoning handoff/);
});

test("公開Issueには期限付きread URL本体を書かない", async () => {
  const source = await readFile(commandRouteSource, "utf8");
  const issueSection = source.slice(source.indexOf("function attachmentIssueLines"), source.indexOf("async function createFreshTaskIssue"));
  assert.doesNotMatch(issueSection, /readUrl/);
  assert.match(issueSection, /contentType/);
  assert.match(issueSection, /size/);
});
