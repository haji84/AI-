import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = new URL("../scripts/code-builder-worker-service.ts", import.meta.url);
const installer = new URL("../scripts/install-code-builder-windows.ps1", import.meta.url);

test("code-builder uses read-only Codex proposal and JARVIS allowlisted apply", async () => {
  const source = await readFile(service, "utf8");
  assert.match(source, /"--sandbox", "read-only"/);
  assert.match(source, /"--output-schema"/);
  assert.match(source, /"--output-last-message"/);
  assert.match(source, /"executionMode":?/);
  assert.match(source, /codex-read-only-proposal-jarvis-apply/);
  assert.match(source, /allowed\.has\(proposed\.path\)/);
  assert.match(source, /writeFile\(resolve\(workspace, proposed\.path\), proposed\.content/);
  assert.doesNotMatch(source, /"--sandbox", "workspace-write"/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
  assert.match(source, /stdio: \["pipe", "pipe", "pipe"\]/);
});

test("Windows installer propagates code-builder execution timeout", async () => {
  const source = await readFile(installer, "utf8");
  assert.match(source, /ExecTimeoutMs/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
});
