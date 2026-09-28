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
  assert.match(workflow, /ref: \$\{\{ steps\.pr\.outputs\.branch \}\}\s+path: target\s+fetch-depth: 0\s+persist-credentials: false/);
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

test("controller bounds each strategy, escalates stagnation and forbids merge deployment and test edits", async () => {
  const controller = await readFile(controllerUrl, "utf8");
  assert.match(controller, /MAX_AUTOMATIC_ATTEMPTS_PER_STRATEGY = 3/);
  assert.match(controller, /MAX_AUTOMATIC_STRATEGIES = 3/);
  assert.match(controller, /SAME_FAILURE_SWITCH_THRESHOLD = 2/);
  assert.match(controller, /chooseRecoveryStrategy/);
  assert.match(controller, /failureFingerprint/);
  assert.match(controller, /PR_NOT_ELIGIBLE_FOR_AUTONOMOUS_RECOVERY/);
  assert.match(controller, /RECOVERY_SCOPE_VIOLATION/);
  assert.match(controller, /RECOVERY_DESTRUCTIVE_CHANGE_REJECTED/);
  assert.match(controller, /Do not commit, push, merge, deploy/);
  assert.match(controller, /Do not weaken or delete tests/);
  assert.match(controller, /AUTOMATIC_RECOVERY_STRATEGIES_EXHAUSTED/);
});


test("coding engine receives no persisted checkout credential", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const controller = await readFile(controllerUrl, "utf8");
  assert.doesNotMatch(workflow, /path: target[\s\S]{0,160}persist-credentials: true/);
  assert.match(controller, /sanitizedBuilderEnvironment/);
  assert.match(controller, /GITHUB_TOKEN/);
  assert.match(controller, /credential\.helper/);
  assert.match(controller, /goriq-push-disabled/);
  assert.match(controller, /pushWithGithubToken/);
});
