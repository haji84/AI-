import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/goriq-ai09-owner-builder-connect.yml", import.meta.url), "utf8");
const owner = workflow.split("  owner-broker-readonly:\n")[1].split("  zbook-builder-readonly:\n")[0];
const selectorUrl = new URL("../scripts/goriq-owner-readback-selection.mjs", import.meta.url);
let selector = null;
try { selector = await import(selectorUrl.href); } catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
const select = (...args) => {
  assert.ok(selector, "workflow readback selector must exist");
  return selector.classifyReadbackSelection(...args);
};
const goal = "goal-fcc81c97e09153f7";
const job = "rotation-recovery-37";

test("owner workflow exposes paired optional Goal and Job string inputs", () => {
  const dispatch = workflow.split("  workflow_dispatch:\n")[1].split("  issues:\n")[0];
  for (const key of ["goal_id", "job_id"]) {
    assert.match(dispatch, new RegExp(`      ${key}:\\n`));
    const block = dispatch.split(`      ${key}:\n`)[1].split(/\n {6}[a-z_]+:/)[0];
    assert.match(block, /required: false/);
    assert.match(block, /type: string/);
  }
});

test("untrusted selector expressions are environment data, never shell source", () => {
  assert.match(owner, /AI09_REQUEST_GOAL_ID: \$\{\{ inputs\.goal_id \|\| '' \}\}/);
  assert.match(owner, /AI09_REQUEST_JOB_ID: \$\{\{ inputs\.job_id \|\| '' \}\}/);
  for (const block of owner.split("        run: |\n").slice(1)) {
    const body = block.split(/\n {6}- name:/)[0];
    assert.doesNotMatch(body, /\$\{\{/);
  }
});

test("selector validation precedes credential loading and preserves explicit choices", () => {
  const validate = owner.indexOf('node scripts/goriq-owner-readback-selection.mjs "$AI09_SELECTED_GOAL" "$AI09_SELECTED_JOB"');
  const source = owner.indexOf('source "$ENV_FILE"');
  assert.ok(validate >= 0 && validate < owner.indexOf('ENV_FILE='));
  assert.ok(source > validate);
  assert.match(owner, /readonly AI09_SELECTED_GOAL="\$\{AI09_REQUEST_GOAL_ID-\}"/);
  assert.match(owner, /readonly AI09_SELECTED_JOB="\$\{AI09_REQUEST_JOB_ID-\}"/);
  assert.ok(owner.indexOf('export GORIQ_AI09_GOAL_ID="$AI09_SELECTED_GOAL"') > source);
  assert.ok(owner.indexOf('export GORIQ_AI09_JOB_ID="$AI09_SELECTED_JOB"') > source);
  assert.match(owner, /if \[\[ -n "\$AI09_SELECTED_GOAL" \]\]; then/);
});

test("protected source, read-only permissions, original triggers and Builder job are retained", () => {
  assert.match(workflow, /ref: main\n {10}persist-credentials: false/g);
  assert.match(owner, /test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(owner, /contents: read/);
  assert.match(workflow, /issues:\n {4}types: \[opened, reopened\]/);
  assert.doesNotMatch(workflow, /pull_request_target|repository_dispatch|contents: write|id-token: write/);
  const builder = "  zbook-builder-readonly:\n" + workflow.split("  zbook-builder-readonly:\n")[1];
  assert.equal(createHash("sha256").update(builder).digest("hex"), "87b0a623d7b6b462857d705fa082adc38bc47c5ac97a029149798641571819e3");
});

for (const [name, g, j, expected] of [
  ["empty legacy selection", "", "", "CONNECTION_ONLY"],
  ["explicit original selection", goal, job, "TARGETED_READBACK"],
  ["minimum identifier length", "abc123", "job123", "TARGETED_READBACK"],
  ["maximum identifier length", "a".repeat(160), "b".repeat(160), "TARGETED_READBACK"],
  ["allowed punctuation", "goal:a_b.c-d", "job:a_b.c-d", "TARGETED_READBACK"],
  ["Goal without Job", goal, "", "INVALID"],
  ["Job without Goal", "", job, "INVALID"],
  ["short Goal", "abc12", job, "INVALID"],
  ["short Job", goal, "abc12", "INVALID"],
  ["oversized Goal", "a".repeat(161), job, "INVALID"],
  ["oversized Job", goal, "b".repeat(161), "INVALID"],
  ["traversal Goal", "goal..escape", job, "INVALID"],
  ["traversal Job", goal, "job..escape", "INVALID"],
  ["leading option", "--goal", job, "INVALID"],
  ["trailing newline", goal + "\n", job, "INVALID"],
  ["embedded newline", goal, "job\n123", "INVALID"],
  ["shell expansion", "$(touch marker)", job, "INVALID"],
  ["shell semicolon", goal, "job;echo token", "INVALID"],
  ["URL encoded traversal", "goal%2e%2e", job, "INVALID"],
  ["leading whitespace", " " + goal, job, "INVALID"],
  ["non-ASCII", "目標abcdef", job, "INVALID"],
  ["number input", 123456, job, "INVALID"],
  ["undefined input", undefined, job, "INVALID"],
  ["object input", {}, job, "INVALID"],
]) {
  test(`readback selection: ${name}`, () => assert.equal(select(g, j), expected));
}

for (const [name, args, status, output] of [
  ["explicit", [goal, job], 0, "TARGETED_READBACK"],
  ["empty", ["", ""], 0, "CONNECTION_ONLY"],
  ["partial", [goal, ""], 2, "INVALID"],
  ["malicious", ["$(echo PRIVATE_SENTINEL)", job], 2, "INVALID"],
  ["missing arguments", [], 2, "INVALID"],
  ["extra arguments", [goal, job, "extra"], 2, "INVALID"],
]) {
  test(`readback selector CLI is bounded and redacted: ${name}`, () => {
    const child = spawnSync(process.execPath, [fileURLToPath(selectorUrl), ...args], {
      encoding: "utf8", timeout: 5000, maxBuffer: 8192,
      env: { ...process.env, JARVIS_OWNER_TOKEN: "PRIVATE_SENTINEL" },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, status);
    assert.equal(child.stdout.trim(), `AI09_READBACK_SELECTION=${output}`);
    assert.equal(child.stderr, "");
    assert.doesNotMatch(child.stdout, /PRIVATE_SENTINEL|goal-fcc81|rotation-recovery/);
  });
}
