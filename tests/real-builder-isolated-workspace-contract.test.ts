import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = new URL("../.github/workflows/gai-real-builder-recovery-e2e.yml", import.meta.url);
const runner = new URL("../scripts/real-builder-recovery-e2e.ts", import.meta.url);

test("real Builder E2E uses isolated user-writable workspace", async () => {
  const wf = await readFile(workflow, "utf8");
  const script = await readFile(runner, "utf8");
  assert.match(wf, /real-builder-e2e-workspace/);
  assert.match(wf, /CODE_BUILDER_TEST_WORKSPACE/);
  assert.match(wf, /git -C $e2eWorkspace init/);
  assert.match(script, /CODE_BUILDER_TEST_WORKSPACE/);
  assert.match(script, /cwd: testWorkspace/);
  assert.match(script, /resolve\(testWorkspace, fixture\)/);
});
