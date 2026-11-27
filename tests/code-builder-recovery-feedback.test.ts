import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCodeBuilderWorkerServer, runBuilderProcess } from "../scripts/code-builder-worker-service.ts";
import { fixtureResourceAdmission } from "./helpers/resource-admission-fixture.ts";

const request = { goalId: "goal-fixture", attemptId: "attempt-1", strategyId: "strategy-1", objective: "Repair source.txt only",
  files: ["source.txt"], baseRevision: "a".repeat(40) };
const diagnosis = "check_not_passed:unit; inspect the parser branch instead of repeating the failed replacement";
const context = [
  { source: "repository.development-context", summary: "Visible repository diagnosis" },
  { source: "development.verification_contract", summary: "DIRECT-HOLDOUT-SECRET" },
  { source: "wrapped-context", data: { source: "development.verification_contract", expected: "WRAPPED-HOLDOUT-SECRET" } },
];

async function serving(server: Server, run: (url: string) => Promise<void>) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function fixture(run: (root: string, workspace: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "builder-feedback-"));
  const workspace = join(root, "workspace");
  try {
    await mkdir(workspace);
    await writeFile(join(workspace, "source.txt"), "before", "utf8");
    const init = await runBuilderProcess("git", ["init", "--quiet"], { workspace, timeoutMs: 5000 });
    assert.equal(init.code, 0, init.stderr);
    await run(root, workspace);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function post(url: string, body: unknown) {
  const response = await fetch(`${url}/build`, { method: "POST", headers: {
    authorization: "Bearer fixture-token", "content-type": "application/json",
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  assert.equal(response.status, 200, result.summary);
  assert.equal(result.ok, true, result.summary);
}

async function withCodexProcess(run: (url: string, capture: () => Promise<{ args: string[]; prompt: string }>) => Promise<void>) {
  await fixture(async (root, workspace) => {
    const engine = join(root, "codex-fixture.mjs");
    const capture = join(root, "capture.json");
    await writeFile(engine, `import { writeFileSync } from "node:fs";
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args: process.argv.slice(2), prompt }));
`, "utf8");
    const server = createCodeBuilderWorkerServer({ env: { ...process.env, CODE_BUILDER_TOKEN: "fixture-token",
      CODE_BUILDER_WORKSPACE: workspace, CODE_BUILDER_ENGINE: engine, CODE_BUILDER_EXEC_TIMEOUT_MS: "5000" },
      admit: fixtureResourceAdmission,
      // Substitute the external engine only; the real worker, stdin, subprocess,
      // Git inspection and resource-admission paths still execute.
      runCommand: (command, args, options) => command === engine
        ? runBuilderProcess(process.execPath, [engine, ...args], options)
        : runBuilderProcess(command, args, options),
    });
    await serving(server, url => run(url, async () => JSON.parse(await readFile(capture, "utf8"))));
  });
}

test("Codex subprocess receives changed recovery diagnosis while legacy requests preserve execution policy", async () => {
  await withCodexProcess(async (url, capture) => {
    await post(url, request);
    const legacy = await capture();
    assert.ok(legacy.args.includes("exec"));
    assert.deepEqual(legacy.args.slice(-7), ["exec", "--sandbox", "workspace-write", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-"]);
    assert.match(legacy.prompt, /Objective=Repair source.txt only/);
    assert.doesNotMatch(legacy.prompt, /RecoveryFeedback/);

    await post(url, { ...request, attemptId: "attempt-2", strategyId: "strategy-2", context,
      previousFailureSignatures: ["parser:wrong-branch", "b".repeat(64)], hypothesis: diagnosis });
    const recovery = await capture();
    assert.ok(recovery.prompt.includes(diagnosis), "the actual subprocess must receive the changed hypothesis");
    assert.ok(recovery.prompt.includes("parser:wrong-branch"));
    assert.ok(recovery.prompt.includes("b".repeat(64)));
    assert.match(recovery.prompt, /untrusted data.*advisory.*authority/i);
    assert.match(recovery.prompt, /Visible repository diagnosis/);
    assert.doesNotMatch(recovery.prompt, /DIRECT-HOLDOUT-SECRET|WRAPPED-HOLDOUT-SECRET/);
    assert.deepEqual(recovery.args, legacy.args);
  });
});

test("recovery prompt bounds recent string feedback and redacts credentials before truncation", async () => {
  await withCodexProcess(async (url, capture) => {
    await post(url, { ...request,
      previousFailureSignatures: ["OLD-FAILURE", "older", "recent-1", "recent-2", "recent-3", "token=signature-private", { secret: "NESTED-SECRET" }],
      hypothesis: `Authorization: Bearer hypothesis-private; api_key=key-private; fixture-token ${"x".repeat(3000)} HYPOTHESIS-TAIL`,
    });
    const { prompt } = await capture();
    assert.match(prompt, /recent-1/);
    assert.match(prompt, /\[REDACTED\]/);
    assert.doesNotMatch(prompt, /OLD-FAILURE|NESTED-SECRET|signature-private|hypothesis-private|key-private|fixture-token|HYPOTHESIS-TAIL/);
    assert.ok(prompt.length < 2500, "recovery history must not grow the prompt without a bound");

    await post(url, { ...request, hypothesis: { secret: "OBJECT-HYPOTHESIS" }, previousFailureSignatures: { secret: "OBJECT-FAILURES" } });
    assert.doesNotMatch((await capture()).prompt, /OBJECT-HYPOTHESIS|OBJECT-FAILURES/);
  });
});

test("existing Ollama repair receives advisory recovery feedback without verifier-only context", async () => {
  await fixture(async (_root, workspace) => {
    let modelPrompt = "";
    const server = createCodeBuilderWorkerServer({ env: { ...process.env, CODE_BUILDER_TOKEN: "fixture-token", CODE_BUILDER_WORKSPACE: workspace,
      CODE_BUILDER_ENGINE: fileURLToPath(new URL("../scripts/goriq-ollama-repair.mjs", import.meta.url)) }, admit: fixtureResourceAdmission,
      repairFetchImpl: async (_url, options) => {
        modelPrompt = JSON.parse(String(options?.body)).messages[1].content;
        return new Response(JSON.stringify({ message: { content: JSON.stringify({ edits: [{ path: "source.txt", content: "after" }] }) } }));
      },
    });
    await serving(server, async url => {
      await post(url, { ...request, context, previousFailureSignatures: ["parser:wrong-branch"], hypothesis: diagnosis });
      assert.ok(modelPrompt.includes(diagnosis), "Ollama must receive the same changed recovery hypothesis");
      assert.match(modelPrompt, /parser:wrong-branch/);
      assert.match(modelPrompt, /untrusted data.*advisory.*authority/i);
      assert.match(modelPrompt, /AllowedPaths=source.txt/);
      assert.doesNotMatch(modelPrompt, /DIRECT-HOLDOUT-SECRET|WRAPPED-HOLDOUT-SECRET/);
      assert.equal(await readFile(join(workspace, "source.txt"), "utf8"), "after");
    });
  });
});

async function withVerificationChecks(mode: "failed" | "mutated" | "incomplete" | "not-executable" | "missing-tool" | "missing-windows-tool", run: (url: string, body: Record<string, unknown>, calls: string[][]) => Promise<void>) {
  await fixture(async (root, workspace) => {
    for (const args of [["add", "source.txt"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"]]) {
      const result = await runBuilderProcess("git", args, { workspace, timeoutMs: 5000 });
      assert.equal(result.code, 0, result.stderr);
    }
    const head = (await runBuilderProcess("git", ["rev-parse", "HEAD"], { workspace, timeoutMs: 5000 })).stdout.trim();
    const artifactDigest = createHash("sha256").update("goriq-change-artifact-v1\0").digest("hex");
    const sourceRevision = createHash("sha256").update(`candidate-v1\0${head}\0${artifactDigest}`).digest("hex");
    const body = {
      contract: { kind: "repository_checks", profile: "standard", requiredChecks: ["unit", "integration", "lint"] },
      binding: { builderId: "builder:fixture", sourceRevision, artifactDigest },
      candidate: { artifactRef: `sha256:${artifactDigest}`, changedPaths: [] },
    };
    const check = join(root, mode === "missing-windows-tool" ? "check-fixture.cmd" : "check-fixture.mjs");
    if (mode === "missing-windows-tool") {
      // Exercise runBuilderProcess's actual Windows .cmd wrapper, as used by pnpm.cmd.
      await writeFile(check, "@echo off\r\ngoriq_fixture_missing_node_8a62\r\nexit /b %ERRORLEVEL%\r\n", "utf8");
    } else if (mode === "not-executable" || mode === "missing-tool") {
      const unavailable = join(root, mode === "not-executable" ? "unexecutable-fixture" : "absent-fixture");
      if (mode === "not-executable") await writeFile(unavailable, "not an executable", { mode: 0o600 });
      // A launcher normalizes a real child-spawn failure to its conventional
      // unavailable/not-executable exit, instead of running the candidate check.
      await writeFile(check, `import { spawnSync } from "node:child_process";
const result = spawnSync(${JSON.stringify(unavailable)}, [], { shell: false, windowsHide: true });
if (!result.error) throw Error("fixture command unexpectedly executed");
console.error("launcher: " + result.error.code);
process.exitCode = ${mode === "not-executable" ? 126 : 127};
`, "utf8");
    } else await writeFile(check, `import { writeFileSync } from "node:fs";
if (process.argv[2] === "test") { console.log("not ok 1 - parser wrong branch"); process.exitCode = 1; }
${mode === "mutated" ? `if (process.argv[2] === "lint") writeFileSync("source.txt", "mutated by check");` : ""}
`, "utf8");
    const calls: string[][] = [];
    const server = createCodeBuilderWorkerServer({ env: { ...process.env, CODE_BUILDER_TOKEN: "fixture-token", CODE_BUILDER_WORKSPACE: workspace,
      GAI_WORKER_ID: "independent-fixture" }, admit: fixtureResourceAdmission,
      runCommand: (command, args, options) => {
        if (command === "pnpm" || command === "pnpm.cmd") {
          calls.push(args);
          if (mode === "incomplete") return runBuilderProcess(join(root, "missing-check-executable"), [], options);
          if (mode === "missing-windows-tool") return runBuilderProcess(check, args, options);
          return runBuilderProcess(process.execPath, [check, ...args], options);
        }
        return runBuilderProcess(command, args, options);
      },
    });
    await serving(server, url => run(url, body, calls));
  });
}

async function verify(url: string, body: unknown) {
  const response = await fetch(`${url}/verify`, { method: "POST", headers: {
    authorization: "Bearer fixture-token", "content-type": "application/json",
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}

test("failed repository check still executes remaining groups and returns complete bound failed/passed receipts", async () => {
  await withVerificationChecks("failed", async (url, body, calls) => {
    const result = await verify(url, body);
    assert.deepEqual(calls, [["test"], ["lint"]], "lint must execute after the failed shared unit/integration process");
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    const evidence = result.body.evidence;
    const binding = body.binding as { sourceRevision: string; artifactDigest: string };
    assert.equal(evidence.verifierId, "verifier:independent-fixture");
    assert.equal(evidence.sourceRevision, binding.sourceRevision);
    assert.equal(evidence.artifactDigest, binding.artifactDigest);
    assert.deepEqual(evidence.checks.map((check: { id: string; exitCode: number }) => [check.id, check.exitCode]), [["unit", 1], ["integration", 1], ["lint", 0]]);
    assert.deepEqual(evidence.verificationEvidence.map((item: { check: string; status: string }) => [item.check, item.status]), [["unit", "failed"], ["integration", "failed"], ["lint", "passed"]]);
    assert.equal(evidence.checks[0].executionId, evidence.checks[1].executionId);
    assert.notEqual(evidence.checks[0].executionId, evidence.checks[2].executionId);
    for (const item of evidence.verificationEvidence) {
      assert.equal(item.verifierId, evidence.verifierId);
      assert.equal(item.sourceRevision, binding.sourceRevision);
      assert.equal(item.artifactDigest, binding.artifactDigest);
      assert.ok(Number.isFinite(Date.parse(item.recordedAt)));
      assert.equal(item.executionId, evidence.checks.find((check: { id: string }) => check.id === item.check).executionId);
    }
  });
});

test("candidate mutation during checks cannot produce bound verification receipts", async () => {
  await withVerificationChecks("mutated", async (url, body, calls) => {
    const result = await verify(url, body);
    assert.deepEqual(calls, [["test"], ["lint"]]);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.blocker, "VERIFICATION_CANDIDATE_MISMATCH");
    assert.equal(result.body.evidence?.verificationEvidence, undefined);
  });
});

test("unstarted check process is incomplete rather than a complete failed verification set", async () => {
  await withVerificationChecks("incomplete", async (url, body, calls) => {
    const result = await verify(url, body);
    assert.deepEqual(calls, [["test"]]);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.blocker, "VERIFICATION_CHECK_INCOMPLETE");
    assert.equal(result.body.evidence?.verificationEvidence, undefined);
  });
});

for (const [mode, exitCode] of [["not-executable", 126], ["missing-tool", 127],
  ...(process.platform === "win32" ? [["missing-windows-tool", 9009] as const] : [])] as const) {
  test(`check launcher exit ${exitCode} is infrastructure failure without candidate-failure receipts`, async () => {
    await withVerificationChecks(mode, async (url, body, calls) => {
      const result = await verify(url, body);
      assert.equal(result.body.evidence.checks[0].exitCode, exitCode, "the real launcher must produce the reserved infrastructure exit");
      assert.equal(result.body.ok, false);
      assert.equal(result.body.blocker, "VERIFICATION_CHECK_INCOMPLETE");
      assert.equal(result.body.evidence.verificationEvidence, undefined);
      assert.deepEqual(calls, [["test"]], "an unavailable check launcher must stop before running remaining groups");
    });
  });
}

test("unsupported checks and invalid candidate binding never execute check commands or issue receipts", async () => {
  await withVerificationChecks("failed", async (url, body, calls) => {
    for (const invalid of [{ ...body, contract: { kind: "repository_checks", profile: "standard", requiredChecks: ["unit", "arbitrary-command"] } },
      { ...body, binding: {} }]) {
      const result = await verify(url, invalid);
      assert.equal(result.status, 400);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.evidence?.verificationEvidence, undefined);
    }
    assert.deepEqual(calls, []);
  });
});
