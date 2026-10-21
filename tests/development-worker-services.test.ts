import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCodeBuilderWorkerServer, runBuilderProcess } from "../scripts/code-builder-worker-service.ts";
import { createResearchWorkerServer } from "../scripts/research-worker-service.ts";
import { runOllamaRepair } from "../scripts/goriq-ollama-repair.mjs";
import { ResourceWaitError, withDevelopmentResourceAdmission } from "../src/gai/development-resource-admission.ts";
import { fixtureResourceAdmission } from "./helpers/resource-admission-fixture.ts";
import { acquireCognitiveLease } from "../src/gai/cognitive-lease.ts";

async function fixture(run: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), "worker-services-"));
  try { await run(workspace); } finally { await rm(workspace, { recursive: true, force: true }); }
}
function pressured(workspace: string): typeof withDevelopmentResourceAdmission {
  return (work, options) => withDevelopmentResourceAdmission(work, { ...options, platform: "win32", leasePath: join(workspace, "heavy.lock"),
    probe: async () => ({ checkedAt: new Date().toISOString(), resources: { cpuLoadPercent: 10, memoryAvailableMb: 8000, diskAvailableMb: 12000, committedMemoryMb: 99000, commitLimitMb: 100000 } }) });
}
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
async function post(url: string, path: string, body: unknown) {
  const response = await fetch(url + path, { method: "POST", headers: { Authorization: "Bearer fixture-token", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

test("Builder build and heavy verification return resource waits while file_exact remains usable", async () => fixture(async workspace => {
  await writeFile(join(workspace, "source.txt"), "fixture", "utf8");
  const server = createCodeBuilderWorkerServer({ env: { CODE_BUILDER_TOKEN: "fixture-token", CODE_BUILDER_WORKSPACE: workspace }, admit: (work, options) => {
    assert.equal(options?.directory, workspace, "admission must probe the actual target filesystem");
    return pressured(workspace)(work, options);
  } });
  await serving(server, async url => {
    for (const [path, body] of [["/build", { goalId: "g", attemptId: "a", strategyId: "s", objective: "Fixture only" }],
      ["/verify", { contract: { kind: "repository_checks", profile: "standard", requiredChecks: ["unit"] } }]] as const) {
      const result = await post(url, path, body);
      assert.equal(result.response.status, 503);
      assert.equal(result.body.blocker, "WAITING_FOR_RESOURCE");
      assert.equal(result.body.resourceWait.status, "WAITING_FOR_RESOURCE");
      assert.deepEqual(result.body.evidence.resourceWait, result.body.resourceWait);
    }
    const cheap = await post(url, "/verify", { contract: { kind: "file_exact", path: "source.txt", expected: "fixture" } });
    assert.equal(cheap.response.status, 200);
    assert.equal(cheap.body.ok, true);
  });
}));

test("research admission returns structured HTTP503 without calling model transport", async () => fixture(async workspace => {
  let modelCalls = 0;
  const server = createResearchWorkerServer({ env: { RESEARCH_WORKER_TOKEN: "fixture-token", GAI_LOCAL_MODEL_ENDPOINT: "http://127.0.0.1:11434" },
    admit: pressured(workspace), fetchImpl: async () => { modelCalls++; throw new Error("unexpected model request"); } });
  await serving(server, async url => {
    const result = await post(url, "/research", { query: "Fixture only" });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.blocker, "WAITING_FOR_RESOURCE");
    assert.deepEqual(result.body.evidence.resourceWait, result.body.resourceWait);
    assert.equal(modelCalls, 0);
  });
}));

test("repository verification executes identical unit/integration command once with shared provenance", async () => fixture(async workspace => {
  for (const args of [["init", "--quiet"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "fixture"]]) {
    assert.equal((await runBuilderProcess("git", args, { workspace })).code, 0);
  }
  const baseRevision = (await runBuilderProcess("git", ["rev-parse", "HEAD"], { workspace })).stdout.trim();
  const artifactDigest = createHash("sha256").update("goriq-change-artifact-v1\0").digest("hex");
  const candidateRevision = createHash("sha256").update(`candidate-v1\0${baseRevision}\0${artifactDigest}`).digest("hex");
  const executions: string[][] = [];
  const server = createCodeBuilderWorkerServer({ env: { CODE_BUILDER_TOKEN: "fixture-token", CODE_BUILDER_WORKSPACE: workspace }, admit: fixtureResourceAdmission,
    runCommand: async (command, args, options) => {
      if (command === "pnpm" || command === "pnpm.cmd") {
        executions.push(args);
        return { code: 0, stdout: "fixture checks passed", stderr: "", timedOut: false, stdoutTruncated: false, stderrTruncated: false };
      }
      return runBuilderProcess(command, args, options);
    } });
  await serving(server, async url => {
    const result = await post(url, "/verify", { contract: { kind: "repository_checks", profile: "standard", requiredChecks: ["unit", "integration", "lint"] },
      binding: { builderId: "fixture-builder", sourceRevision: candidateRevision, artifactDigest }, candidate: { artifactRef: `sha256:${artifactDigest}`, changedPaths: [] } });
    assert.equal(result.body.ok, true);
    assert.deepEqual(executions, [["test"], ["lint"]]);
    const checks = result.body.evidence.checks;
    assert.deepEqual(checks.map((check: { id: string }) => check.id), ["unit", "integration", "lint"]);
    assert.equal(checks[0].executionId, checks[1].executionId);
    assert.notEqual(checks[0].executionId, checks[2].executionId);
    for (const evidence of result.body.evidence.verificationEvidence) {
      assert.equal(evidence.executionId, checks.find((check: { id: string }) => check.id === evidence.check).executionId);
    }
  });
}));

test("Builder subprocess retains bounded totals across multiple stdout/stderr chunks", async () => fixture(async workspace => {
  const script = "for(let i=0;i<8;i++){process.stdout.write('x'.repeat(60000));process.stderr.write('e'.repeat(60000));await new Promise(r=>setTimeout(r,2));}process.stdout.write('FINAL-OUT');process.stderr.write('FINAL-ERR');";
  const result = await runBuilderProcess(process.execPath, ["--input-type=module", "-e", script], { workspace, timeoutMs: 5000 });
  assert.equal(result.code, 0);
  assert.ok(result.stdout.length <= 100000);
  assert.ok(result.stderr.length <= 100000);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
  assert.ok(result.stdout.endsWith("FINAL-OUT"));
  assert.ok(result.stderr.endsWith("FINAL-ERR"));
}));

test("standalone Ollama repair defers before transport or edits under pressure", async () => fixture(async workspace => {
  await writeFile(join(workspace, "source.txt"), "unchanged", "utf8");
  let modelCalls = 0;
  await assert.rejects(() => runOllamaRepair({ workspace, prompt: "AllowedPaths=source.txt", model: "fixture", endpoint: "http://127.0.0.1:11434" }, {
    admit: (work, options) => { assert.equal(options?.directory, workspace); return pressured(workspace)(work, options); }, fetchImpl: async () => { modelCalls++; throw new Error("unexpected model request"); },
  }), ResourceWaitError);
  assert.equal(modelCalls, 0);
}));

test("configured local repair engine uses Builder admission once without reacquiring its own lane", async () => fixture(async workspace => {
  await writeFile(join(workspace, "source.txt"), "before", "utf8");
  for (const args of [["init", "--quiet"], ["add", "source.txt"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]]) {
    assert.equal((await runBuilderProcess("git", args, { workspace })).code, 0);
  }
  let admissions = 0, modelCalls = 0;
  const server = createCodeBuilderWorkerServer({ env: { ...process.env, CODE_BUILDER_TOKEN: "fixture-token", CODE_BUILDER_WORKSPACE: workspace,
    CODE_BUILDER_ENGINE: fileURLToPath(new URL("../scripts/goriq-ollama-repair.mjs", import.meta.url)) },
    admit: (work, options) => { admissions++; return fixtureResourceAdmission(work, options); },
    repairFetchImpl: async () => { modelCalls++; return new Response(JSON.stringify({ message: { content: JSON.stringify({ edits: [{ path: "source.txt", content: "after" }] }) } })); },
  });
  await serving(server, async url => {
    const result = await post(url, "/build", { goalId: "g", attemptId: "a", strategyId: "s", objective: "Fixture repair only", files: ["source.txt"] });
    assert.equal(result.body.ok, true, result.body.summary);
    assert.deepEqual(result.body.changedPaths, ["source.txt"]);
    assert.equal(admissions, 1);
    assert.equal(modelCalls, 1);
  });
}));

test("direct repair CLI signals a busy heavy lane as visible temporary wait exit75", async () => fixture(async workspace => {
  const laneRoot = process.platform === "darwin" ? join(workspace, "Library", "Application Support", "GAIWorker") : join(workspace, "GAIWorker");
  await mkdir(laneRoot, { recursive: true });
  const release = await acquireCognitiveLease(join(laneRoot, "development-heavy.lock"));
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/goriq-ollama-repair.mjs", import.meta.url)), "--workspace", workspace, "--model", "fixture"], {
      windowsHide: true, env: { ...process.env, LOCALAPPDATA: workspace, XDG_STATE_HOME: workspace, HOME: workspace }, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdin.end("AllowedPaths=source.txt\nFixture only");
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(code, 75);
    assert.equal(stdout, "");
    assert.equal(JSON.parse(stderr.trim()).blocker, "WAITING_FOR_RESOURCE");
    assert.equal(JSON.parse(stderr.trim()).resourceWait.status, "WAITING_FOR_RESOURCE");
  } finally { await release(); }
}));
