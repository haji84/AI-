import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = new URL("../scripts/code-builder-worker-service.ts", import.meta.url);
const installer = new URL("../scripts/install-code-builder-windows.ps1", import.meta.url);

test("code-builder uses explicit noninteractive Codex policy and bounded timeout", async () => {
  const source = await readFile(service, "utf8");
  assert.match(source, /"exec", "--sandbox", "workspace-write"/);
  assert.ok(
    source.indexOf('"exec", "--sandbox", "workspace-write"') >= 0,
    "Codex must use documented exec workspace-write syntax",
  );
  assert.doesNotMatch(source, /"--ask-for-approval", "never"/);
  assert.match(source, /"--ephemeral"/);
  assert.match(source, /"--ignore-user-config"/);
  assert.match(source, /"--ignore-rules"/);
  assert.doesNotMatch(source, /"--full-auto"/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
  assert.ok(source.includes('windows.sandbox="unelevated"'));
  assert.ok(source.includes('.join(" | ")'));
  assert.match(source, /stdio: \["ignore", "pipe", "pipe"\]/);
  assert.match(source, /timedOut/);
});

test("Windows installer propagates code-builder execution timeout", async () => {
  const source = await readFile(installer, "utf8");
  assert.match(source, /ExecTimeoutMs/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
});
