import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

const workflow = await readFile(new URL("../.github/workflows/goriq-pr-ci-recovery.yml", import.meta.url), "utf8");
const workspace = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const head = "a".repeat(40);
const newerHead = "b".repeat(40);
const repository = "haji84/AI-";
const initialPr = {
  number: 1845,
  state: "open",
  head: { ref: "codex/1845-test", sha: head, repo: { full_name: repository } },
  base: { ref: "main", repo: { full_name: repository } },
};
const event = {
  repo: { owner: "haji84", repo: "AI-" },
  payload: {
    workflow_run: {
      id: 12345, name: "CI", status: "completed", conclusion: "failure", event: "pull_request",
      head_sha: head, pull_requests: [{ number: 1845 }],
    },
  },
};

function api({ prs = [initialPr], files = [{ filename: "src/gai/worker-runtime.ts", status: "modified" }], error } = {}) {
  const reads = [];
  const pages = [];
  return {
    reads, pages,
    rest: { pulls: {
      async get(args) {
        reads.push(args);
        if (error) throw error;
        return { data: JSON.parse(JSON.stringify(prs[Math.min(reads.length - 1, prs.length - 1)])) };
      },
      async listFiles(args) {
        pages.push(args);
        if (error) throw error;
        return { data: files.slice((args.page - 1) * args.per_page, args.page * args.per_page) };
      },
    } },
  };
}

function steps(job) {
  const block = workflow.split(`  ${job}:`)[1]?.split(/^ {2}[\w-]+:/m)[0];
  assert.ok(block, `workflow contains ${job}`);
  return block.split(/^ {6}- /m).slice(1).map((body) => {
    const match = body.match(/^ {10}script: \|\r?\n((?:^ {12}.*\r?\n?)*)/m);
    return {
      body,
      id: body.match(/^ {8}id: (.+)$/m)?.[1]?.trim(),
      condition: body.match(/^ {8}if: (.+)$/m)?.[1]?.trim(),
      script: match?.[1].split(/\r?\n/).map((line) => line.slice(12)).join("\n"),
    };
  });
}

async function execute(script, github, context = event, overrides = {}) {
  const outputs = {};
  const notices = [];
  const core = {
    setOutput(key, value) { outputs[key] = String(value); },
    notice(value) { notices.push(value); },
  };
  const env = {
    ...process.env, GITHUB_WORKSPACE: workspace, GITHUB_REPOSITORY: repository,
    GORIQ_RECOVERY_CONTROL_WORKSPACE: workspace,
    GORIQ_RECOVERY_PR_NUMBER: "1845", GORIQ_RECOVERY_HEAD_SHA: head,
    GORIQ_RECOVERY_BRANCH: initialPr.head.ref,
    ...overrides,
  };
  await new AsyncFunction("github", "context", "core", "require", "process", script)(
    github, JSON.parse(JSON.stringify(context)), core, require, { env },
  );
  return { outputs, notices };
}

async function preflight(github, context) {
  const script = steps("preflight").find((step) => step.script)?.script;
  assert.ok(script, "hosted preflight has executable control");
  return execute(script, github, context);
}

// These run the actual Actions script with only the external GitHub API replaced.
test("hosted preflight rejects all protected paths before native allocation", async () => {
  const github = api({ files: [
    { filename: ".github/workflows/ci.yml", status: "modified" },
    { filename: "tests/regression.test.ts", status: "modified" },
    { filename: "src/gai/token-store.ts", status: "modified" },
    { filename: "package.json", status: "modified" },
  ] });
  const { outputs } = await preflight(github);
  assert.equal(outputs.eligible, "false");
  assert.equal(outputs.reason, "NO_AUTONOMOUS_REPAIR_PATHS");
});

test("hosted preflight paginates past one hundred protected files to find an allowed change", async () => {
  const github = api({ files: [
    ...Array.from({ length: 100 }, (_, i) => ({ filename: `tests/case-${i}.test.ts`, status: "modified" })),
    { filename: "src/gai/worker-runtime.ts", status: "modified" },
  ] });
  const { outputs } = await preflight(github);
  assert.equal(outputs.eligible, "true");
  assert.equal(outputs.head_sha, head);
  assert.deepEqual(github.pages.map(({ page, per_page }) => [page, per_page]), [[1, 100], [2, 100]]);
});

test("empty and removed paths do not justify a native recovery", async () => {
  for (const files of [[], [{ filename: "", status: "modified" }], [{ filename: "src/gai/worker-runtime.ts", status: "removed" }]]) {
    assert.equal((await preflight(api({ files }))).outputs.eligible, "false");
  }
});

test("renames cannot turn protected previous paths into repairable paths", async () => {
  for (const previous_filename of ["tests/moved.test.ts", "src/gai/token-store.ts", undefined]) {
    const files = [{ filename: "src/gai/moved.ts", status: "renamed", previous_filename }];
    assert.equal((await preflight(api({ files }))).outputs.eligible, "false");
  }
  const files = [{ filename: "src/gai/moved.ts", status: "renamed", previous_filename: "src/gai/previous.ts" }];
  assert.equal((await preflight(api({ files }))).outputs.eligible, "true");
});

test("missing, closed, fork and stale PR events never allocate recovery", async () => {
  const contexts = [
    { ...event, payload: { workflow_run: { ...event.payload.workflow_run, pull_requests: [] } } },
    { ...event, payload: { workflow_run: { ...event.payload.workflow_run, conclusion: "success" } } },
  ];
  for (const context of contexts) assert.equal((await preflight(api(), context)).outputs.eligible, "false");
  for (const pr of [
    { ...initialPr, state: "closed" },
    { ...initialPr, head: { ...initialPr.head, repo: { full_name: "other/fork" } } },
    { ...initialPr, head: { ...initialPr.head, sha: newerHead } },
  ]) assert.equal((await preflight(api({ prs: [pr] }))).outputs.eligible, "false");
});

test("head changing during file pagination cannot borrow the old failed-run evidence", async () => {
  const github = api({ prs: [initialPr, { ...initialPr, head: { ...initialPr.head, sha: newerHead } }] });
  assert.equal((await preflight(github)).outputs.eligible, "false");
});

test("same-head CI retry stays eligible while a new-head event needs its own evidence", async () => {
  for (const id of [12345, 12346]) {
    const context = { ...event, payload: { workflow_run: { ...event.payload.workflow_run, id } } };
    assert.equal((await preflight(api(), context)).outputs.eligible, "true");
  }
  const context = { ...event, payload: { workflow_run: { ...event.payload.workflow_run, head_sha: newerHead } } };
  assert.equal((await preflight(api(), context)).outputs.eligible, "false");
});

test("GitHub read failure is visible instead of a successful eligibility receipt", async () => {
  await assert.rejects(preflight(api({ error: new Error("API unavailable") })), /API unavailable/);
});

test("a later file-page API error fails visibly without publishing eligibility", async () => {
  const github = api({ files: Array.from({ length: 100 }, () => ({ filename: "src/gai/runtime.ts", status: "modified" })) });
  const listFiles = github.rest.pulls.listFiles;
  github.rest.pulls.listFiles = async (args) => {
    if (args.page === 2) throw new Error("file page unavailable");
    return listFiles(args);
  };
  await assert.rejects(preflight(github), /file page unavailable/);
});

test("truncated and malformed file lists cannot grant eligibility", async () => {
  const github = api({ prs: [{ ...initialPr, changed_files: 2 }] });
  await assert.rejects(preflight(github), /RECOVERY_FILE_LIST_INCOMPLETE/);
  github.rest.pulls.listFiles = async () => ({ data: null });
  await assert.rejects(preflight(github), /RECOVERY_FILE_LIST_INVALID/);
});

test("file pagination is bounded and does not assume an incomplete last page is complete", async () => {
  const github = api();
  let pages = 0;
  github.rest.pulls.listFiles = async () => {
    pages += 1;
    return { data: Array.from({ length: 100 }, () => ({ filename: "src/gai/runtime.ts", status: "modified" })) };
  };
  await assert.rejects(preflight(github), /RECOVERY_FILE_LIST_LIMIT/);
  assert.equal(pages, 30);
});

test("queued receipt cannot substitute a different PR, branch or failed head", async () => {
  const script = steps("recover").find((step) => step.script)?.script;
  assert.ok(script);
  for (const overrides of [
    { GORIQ_RECOVERY_PR_NUMBER: "1846" },
    { GORIQ_RECOVERY_HEAD_SHA: newerHead },
    { GORIQ_RECOVERY_BRANCH: "codex/different" },
  ]) {
    const result = await execute(script, api(), event, overrides);
    assert.equal(result.outputs.eligible, "false");
    assert.equal(result.outputs.head_sha, undefined);
  }
});

test("native controller and hosted preflight share the same repair policy function", async () => {
  const controller = await import("../scripts/goriq-pr-ci-recovery.ts");
  const helper = await import("../scripts/goriq-pr-ci-recovery-preflight.mjs");
  assert.equal(controller.allowedRepairPaths, helper.allowedRepairPaths);
  assert.deepEqual(helper.allowedRepairPaths([
    "src/gai/z.ts", "src/gai/a.ts", "src/gai/z.ts", "tests/fixture.ts",
    "scripts/check.test.mjs", "src/gai/token-store.ts", ".github/workflows/ci.yml", "AGENTS.md",
  ]), ["src/gai/a.ts", "src/gai/z.ts"]);
});

async function nativeJob(github) {
  const results = {};
  const expensive = [];
  let freshnessChecked = false;
  for (const step of steps("recover")) {
    if (step.condition) {
      const condition = step.condition.match(/^steps\.(\w+)\.outputs\.eligible == 'true'$/);
      assert.ok(condition, `supported eligibility gate: ${step.condition}`);
      if (results[condition[1]]?.eligible !== "true") continue;
    }
    if (step.script) {
      const result = await execute(step.script, github);
      results[step.id] = result.outputs;
      freshnessChecked = true;
    } else if (!step.body.startsWith("name: Checkout trusted recovery control")) {
      expensive.push(step.body.split(/\r?\n/)[0]);
    }
  }
  return { expensive, freshnessChecked };
}

test("queued recovery rechecks current PR before any target checkout, setup or dependency install", async () => {
  for (const pr of [
    { ...initialPr, state: "closed" },
    { ...initialPr, head: { ...initialPr.head, sha: newerHead } },
  ]) {
    const result = await nativeJob(api({ prs: [pr] }));
    assert.equal(result.freshnessChecked, true);
    assert.deepEqual(result.expensive, []);
  }
});

test("current queued receipt permits unchanged setup, verification and recovery after the check", async () => {
  const result = await nativeJob(api());
  assert.equal(result.freshnessChecked, true);
  assert.ok(result.expensive.some((name) => name.includes("Install target dependencies")));
  assert.ok(result.expensive.some((name) => name.includes("Run bounded autonomous CI recovery")));
});

test("target checkout is pinned to the hosted failed-head receipt", () => {
  const target = steps("recover").find((step) => /path: target/.test(step.body));
  assert.ok(target);
  assert.match(target.body, /ref: \$\{\{ needs\.preflight\.outputs\.head_sha \}\}/);
  assert.match(target.body, /persist-credentials: false/);
});
