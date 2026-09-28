import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL("../.github/workflows/goriq-pr-ci-recovery.yml", import.meta.url);
const controllerUrl = new URL("../scripts/goriq-pr-ci-recovery.ts", import.meta.url);

test("CI recovery triggers only from failed pull-request CI", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["CI"\]/);
  assert.match(workflow, /workflow_run\.conclusion == 'failure'/);
  assert.match(workflow, /workflow_run\.event == 'pull_request'/);
});

test("trusted control checkout is separated from target PR checkout", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /ref: main\s+path: control\s+persist-credentials: false/);
  assert.match(workflow, /ref: \$\{\{ steps\.pr\.outputs\.branch \}\}\s+path: target/);
  assert.match(workflow, /node \.\\control\\scripts\\goriq-pr-ci-recovery\.ts/);
  assert.match(workflow, /GORIQ_RECOVERY_CONTROL_WORKSPACE/);
});

test("write authority is branch-fix scoped and does not grant deploy authority", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /deployments:\s*write|id-token:\s*write|secrets:\s*write/);
});

test("controller bounds attempts and forbids merge deployment and test edits", async () => {
  const controller = await readFile(controllerUrl, "utf8");
  assert.match(controller, /MAX_AUTOMATIC_ATTEMPTS = 3/);
  assert.match(controller, /PR_NOT_ELIGIBLE_FOR_AUTONOMOUS_RECOVERY/);
  assert.match(controller, /RECOVERY_SCOPE_VIOLATION/);
  assert.match(controller, /Do not commit, push, merge, deploy/);
  assert.match(controller, /Do not weaken or delete tests/);
  assert.match(controller, /AUTOMATIC_RECOVERY_ATTEMPT_BUDGET_EXHAUSTED/);
});
