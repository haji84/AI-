import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandChatSource = new URL("../src/app/CommandChat.tsx", import.meta.url);
const commandRouteSource = new URL("../src/app/api/command/route.ts", import.meta.url);
const presignRouteSource = new URL("../src/app/api/attachments/presign/route.ts", import.meta.url);

test("AI Chat supports multiple private direct uploads before command dispatch", async () => {
  const source = await readFile(commandChatSource, "utf8");
  assert.match(source, /＋ 添付/);
  assert.match(source, /multiple/);
  assert.match(source, /\/api\/attachments\/presign/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /body: file/);
  assert.match(source, /body\.attachment\.type/);
  assert.match(source, /attachments/);
  assert.match(source, /MAX_ATTACHMENTS = 20/);
});

test("attachment presign endpoint is owner-only and fails closed without Blob storage", async () => {
  const source = await readFile(presignRouteSource, "utf8");
  assert.match(source, /BLOB_READ_WRITE_TOKEN/);
  assert.match(source, /verifyOwnerSessionToken/);
  assert.match(source, /status: 503/);
  assert.doesNotMatch(source, /access:\s*["']public["']/);
});

test("attachment commands always create a fresh task and pass only metadata URLs", async () => {
  const source = await readFile(commandRouteSource, "utf8");
  assert.match(source, /validAttachments\.length > 0 \|\| dashboardCommandStartsFreshTask/);
  assert.match(source, /validAttachments\.length > 0 \|\| dashboardCommandNeedsReasoning/);
  assert.match(source, /Private Blob/);
  assert.match(source, /read-url:/);
  assert.match(source, /never mirror file bodies into GitHub/);
  assert.doesNotMatch(source, /base64/);
});
