import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = new URL("../scripts/code-builder-worker-service.ts", import.meta.url);
const installer = new URL("../scripts/install-code-builder-windows.ps1", import.meta.url);

test("code-builder uses explicit noninteractive Codex policy and bounded timeout", async () => {
  const source = await readFile(service, "utf8");
  assert.match(source, /"exec"/);
  assert.match(source, /"--sandbox", "workspace-write"/);
  assert.ok(
    source.indexOf('"exec"') < source.indexOf('"--sandbox", "workspace-write"'),
    "Codex exec subcommand must precede exec sandbox options",
  );
  assert.doesNotMatch(source, /"--ask-for-approval", "never"/);
  assert.match(source, /"--ephemeral"/);
  assert.match(source, /"--ignore-user-config"/);
  assert.match(source, /"--ignore-rules"/);
  assert.doesNotMatch(source, /"--full-auto"/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
  assert.ok(source.includes('windows.sandbox="unelevated"'));
  assert.ok(source.includes('.join(" | ")'));
  assert.match(source, /stdio: \[stdinInput === undefined \? "ignore" : "pipe", "pipe", "pipe"\]/);
  assert.match(source, /child\.stdin\.end\(stdinInput\)/);
  assert.match(source, /"--ignore-rules",\s*"-"/);
  assert.match(source, /timedOut/);
});

test("Windows installer propagates code-builder execution timeout", async () => {
  const source = await readFile(installer, "utf8");
  assert.match(source, /ExecTimeoutMs/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
});


test("Builder timeout is recoverable and Windows process trees are terminated", async () => {
  const source = await readFile(service, "utf8");
  assert.match(source, /taskkill\.exe/);
  assert.match(source, /result\.timedOut/);
  assert.match(source, /timed out after/);
  assert.match(source, /result\.code === 0 \|\| transientEngineFailure/);
});


test("capacity and rate-limit failures stay recoverable instead of becoming explicit blockers", async () => {
  const source = await readFile(service, "utf8");
  assert.match(source, /at capacity\|rate limit\|429\|502\|503\|504/);
  assert.match(source, /transientEngineFailure/);
  assert.match(source, /temporarily unavailable/);
  assert.match(source, /result\.code === 0 \|\| transientEngineFailure\s*\? undefined/);
});
