import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = new URL("../scripts/code-builder-worker-service.ts", import.meta.url);
const installer = new URL("../scripts/install-code-builder-windows.ps1", import.meta.url);

test("code-builder uses explicit noninteractive Codex policy and bounded timeout", async () => {
  const source = await readFile(service, "utf8");
  assert.match(source, /"--sandbox", "workspace-write"/);
  assert.match(source, /"--ask-for-approval", "never"/);
  assert.ok(
    source.indexOf('"--ask-for-approval", "never"') < source.indexOf('"exec"'),
    "approval flag must be placed before the exec subcommand",
  );
  assert.match(source, /"--ephemeral"/);
  assert.match(source, /"--ignore-user-config"/);
  assert.doesNotMatch(source, /"--full-auto"/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
});

test("Windows installer propagates code-builder execution timeout", async () => {
  const source = await readFile(installer, "utf8");
  assert.match(source, /ExecTimeoutMs/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
});
