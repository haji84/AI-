import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { runInNewContext } from "node:vm";

const script = new URL("../scripts/wake-zbook-from-macbook.sh", import.meta.url);
const workflow = new URL("../.github/workflows/zbook-wake-via-macbook.yml", import.meta.url);

test("MacBook ZBook wake helper derives MAC from ARP and fails closed otherwise", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /arp", "-n", ip/);
  assert.match(source, /mac_address_not_found_in_arp_cache/);
  assert.match(source, /SO_BROADCAST/);
  assert.match(source, /255\.255\.255\.255/);
  assert.doesNotMatch(source, /[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}/);
});

test("wake workflow is MacBook-only and issue-triggered", async () => {
  const source = await readFile(workflow, "utf8");
  assert.match(source, /runs-on: \[self-hosted, macOS\]/);
  assert.match(source, /\[JARVIS ZBOOK WAKE\]/);
  assert.match(source, /192\.168\.0\.169/);
});

function stepSource(source: string, name: string): string {
  const step = source.split(`      - name: ${name}\n`)[1]?.split(/\n {6}- /)[0];
  assert.ok(step, `Required workflow step: ${name}`);
  const body = step.match(/ {8}run: \|\n((?: {10}.*\n?)+)/)?.[1];
  assert.ok(body, `Executable workflow step: ${name}`);
  return body.split("\n").map(line => line.slice(10)).join("\n");
}

test("every wake mode binds trusted owner repository main before any self-hosted step", async () => {
  const source = await readFile(workflow, "utf8");
  const condition = source.match(/^ {4}if: (.+)$/m)?.[1];
  assert.ok(condition);
  const trusted = { repository: "haji84/AI-", actor: "haji84", ref: "refs/heads/main", event_name: "workflow_dispatch", event: { issue: { title: "[JARVIS ZBOOK WAKE] bounded wake" } } };
  const enabled = (github: typeof trusted) => runInNewContext(condition, { github, startsWith: (value: string, prefix: string) => value.startsWith(prefix) }, { timeout: 100 });
  assert.equal(enabled(trusted), true);
  assert.equal(enabled({ ...trusted, event_name: "issues" }), true);
  assert.equal(enabled({ ...trusted, event_name: "issues", event: { issue: { title: "unrelated" } } }), false);
  for (const change of [{ actor: "foreign" }, { repository: "foreign/AI-" }, { ref: "refs/heads/other" }]) {
    for (const event_name of ["workflow_dispatch", "issues"]) assert.equal(enabled({ ...trusted, ...change, event_name }), false);
  }
});

test("the actual Mac Bash precheck reserves fresh source and preserves all existing state", { skip: process.platform === "win32" }, async () => {
  const source = await readFile(workflow, "utf8");
  const guard = stepSource(source, "Require unused per-run wake source directory");
  assert.equal(source.indexOf("Require unused per-run wake source directory") < source.indexOf("uses: actions/checkout@v5"), true);
  const syntax = spawnSync("bash", ["-n"], { input: guard, encoding: "utf8", timeout: 5000 });
  assert.equal(syntax.status, 0, syntax.stderr);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wake workspace preserve-")));
  const alias = root + "-alias";
  try {
    mkdirSync(join(root, ".jarvis")); mkdirSync(join(root, ".goriq-handoff"));
    const canaries = [join(root, ".jarvis", "compass.db"), join(root, ".goriq-handoff", "retained.json")];
    for (const file of canaries) writeFileSync(file, "PRIVATE_ORIGINAL_CANARY");
    const prefix = join(root, "goriq-zbook-wake-source-42-");
    mkdirSync(prefix + "2"); writeFileSync(join(prefix + "2", "retained.txt"), "PRIVATE_EXISTING_SOURCE");
    writeFileSync(prefix + "3", "PRIVATE_EXISTING_FILE");
    symlinkSync(join(root, "missing-target"), prefix + "4");
    symlinkSync(root, alias);
    const before = canaries.map(file => ({ bytes: readFileSync(file), mode: statSync(file).mode, ino: statSync(file).ino }));
    const run = (env: Record<string, string>) => spawnSync("bash", ["-c", guard], {
      encoding: "utf8", timeout: 5000, cwd: root,
      env: { ...process.env, GITHUB_WORKSPACE: root, GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", ...env },
    });
    const fresh = run({});
    assert.equal(fresh.status, 0, fresh.stderr); assert.equal(fresh.stdout, "");
    assert.equal(statSync(prefix + "1").isDirectory(), true);
    for (const attempt of ["1", "2", "3", "4"]) {
      const refused = run({ GITHUB_RUN_ATTEMPT: attempt });
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /ZBOOK_WAKE_SOURCE_DIRECTORY_NOT_FRESH/);
      assert.doesNotMatch(refused.stdout + refused.stderr, /PRIVATE_|wake workspace/);
    }
    const invalidContexts: Array<Record<string, string>> = [
      { GITHUB_WORKSPACE: "" }, { GITHUB_WORKSPACE: "relative" }, { GITHUB_WORKSPACE: alias },
      { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ID: "42/../43" }, { GITHUB_RUN_ID: "42\n" },
      { GITHUB_RUN_ATTEMPT: "" }, { GITHUB_RUN_ATTEMPT: "01" }, { GITHUB_RUN_ATTEMPT: "../2" },
    ];
    for (const env of invalidContexts) {
      const refused = run(env);
      assert.notEqual(refused.status, 0); assert.match(refused.stderr, /ZBOOK_WAKE_SOURCE_CONTEXT_INVALID/);
    }
    for (const [index, file] of canaries.entries()) {
      assert.deepEqual(readFileSync(file), before[index].bytes);
      assert.equal(statSync(file).mode, before[index].mode); assert.equal(statSync(file).ino, before[index].ino);
    }
    assert.equal(readFileSync(join(prefix + "2", "retained.txt"), "utf8"), "PRIVATE_EXISTING_SOURCE");
    assert.equal(readFileSync(prefix + "3", "utf8"), "PRIVATE_EXISTING_FILE");
  } finally { rmSync(alias, { force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("wake consumes only isolated exact approved source and uploads only that invocation output", async () => {
  const source = await readFile(workflow, "utf8");
  const fresh = "goriq-zbook-wake-source-${{ github.run_id }}-${{ github.run_attempt }}";
  const checkout = source.split("      - uses: actions/checkout@v5")[1]?.split("      - uses:")[0];
  assert.ok(checkout);
  assert.ok(checkout.includes("path: " + fresh));
  assert.match(checkout, /ref: \$\{\{ github.sha \}\}/);
  assert.match(checkout, /clean: false/); assert.match(checkout, /persist-credentials: false/);
  assert.match(source, /node-version: '24\.19\.0'/);
  const gate = stepSource(source, "Require exact approved protected-main source");
  assert.match(gate, /git rev-parse HEAD/); assert.match(gate, /GITHUB_SHA/);
  assert.match(gate, /node scripts\/goriq-pc-approved-source.mjs/);
  assert.ok(source.indexOf("Require exact approved protected-main source") < source.indexOf("Send bounded Wake-on-LAN"));
  assert.ok(source.includes("GORIQ_PC_APPROVED_REVISION: ${{ github.sha }}"));
  if (process.platform !== "win32") {
    const substituted = spawnSync("bash", ["-c", gate], {
      encoding: "utf8", timeout: 5000, env: { ...process.env, GITHUB_SHA: "0".repeat(40) },
    });
    assert.notEqual(substituted.status, 0);
    assert.match(substituted.stderr, /ZBOOK_WAKE_SOURCE_REVISION_MISMATCH/);
    assert.equal(substituted.stdout, "");
  }
  const wake = stepSource(source, "Send bounded Wake-on-LAN to ZBook");
  assert.match(wake, /bash scripts\/wake-zbook-from-macbook.sh 192\.168\.0\.169/);
  assert.doesNotMatch(wake, /chmod|git clean|rm /);
  assert.match(wake, /tee \.gai-results\/zbook-wake-status.json/);
  assert.ok(source.includes("path: " + fresh + "/.gai-results/zbook-wake-status.json"));
  assert.doesNotMatch(source, /path: ~\/Library/);
  const upload = source.split("      - name: Upload wake evidence")[1];
  assert.ok(upload.includes("steps.source_precheck.outcome == 'success'"));
  assert.ok(upload.includes("steps.source_checkout.outcome == 'success'"));
  assert.ok(upload.includes("steps.approved_source.outcome == 'success'"));
  assert.match(upload, /steps.wake.outcome == 'success'.*steps.wake.outcome == 'failure'/);
  const uploadCondition = upload.match(/if: \$\{\{ (.*) \}\}/)?.[1];
  assert.ok(uploadCondition);
  for (const precheck of ["success", "failure"]) for (const checkout of ["success", "failure"]) {
    for (const approved of ["success", "failure"]) for (const wake of ["success", "failure", "cancelled", "skipped"]) {
      const actual = runInNewContext(uploadCondition, { always: () => true, steps: {
        source_precheck: { outcome: precheck }, source_checkout: { outcome: checkout },
        approved_source: { outcome: approved }, wake: { outcome: wake },
      } }, { timeout: 100 });
      assert.equal(actual, precheck === "success" && checkout === "success" && approved === "success" && wake !== "skipped");
    }
  }
  assert.match(source, /timeout-minutes: 5/); assert.match(source, /contents: read/);
});
