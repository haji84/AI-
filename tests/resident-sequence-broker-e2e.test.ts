import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { createDevelopmentVerificationPlan } from "../src/orchestrator/development-verification-plan.ts";
import { localOllamaFixtureSourcePath, localOllamaFixtureTestPath } from "../src/orchestrator/local-ollama-tdd.ts";
import { residentDevelopmentGoalDigest } from "../src/orchestrator/resident-development-sequence.ts";
import { canonicalLocalVerifierPayload, type SignedLocalVerifierPayload } from "../src/orchestrator/signed-local-verifier-receipt.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const delay = (ms: number) => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

// This is a real Broker/executor process regression with mock inference and
// fixture signatures and synthetic resource telemetry. Admission policy and its
// lease remain real. It does not certify native resources, reboot or signer isolation.
test("authenticated Broker sequence resumes after process restart and automatically creates the next Job (fixture signer/Ollama)",
  { timeout: 180_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "goriq-broker-sequence-"));
    const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
    const repo = join(root, "repo"), compassPath = join(root, "state", "compass.db");
    let child: ChildProcess | undefined, diagnostics = "", generations = 0;
    const content = "def add(a, b):\n    return a + b\n";
    const mockOllama = createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/tags") return response.end(JSON.stringify({ models: [{ name: "fixture-model" }] }));
      if (request.url !== "/api/generate" || request.method !== "POST") { response.statusCode = 404; return response.end("{}"); }
      request.resume(); request.once("end", () => {
        generations++;
        response.end(JSON.stringify({ done: true, model: "fixture-model", response: JSON.stringify({ path: localOllamaFixtureSourcePath, content }) }));
      });
    });
    const stopBroker = async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit"); child.kill(); await exited;
      }
      child = undefined;
    };
    try {
      mkdirSync(repo); mkdirSync(join(root, "state"));
      const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
      git("init", "-q"); git("config", "core.autocrlf", "false"); git("config", "user.name", "fixture"); git("config", "user.email", "fixture@example.invalid");
      mkdirSync(join(repo, "tests", "fixtures"), { recursive: true }); writeFileSync(join(repo, "tests", "fixtures", ".keep"), "fixture\n");
      git("add", "."); git("commit", "-qm", "fixture"); const baseRevision = git("rev-parse", "HEAD");
      const workspaces = [join(root, "candidate-a"), join(root, "candidate-b")];
      for (const workspace of workspaces) git("worktree", "add", "--detach", workspace, baseRevision);
      const python = process.env.GORIQ_LOCAL_TDD_PYTHON || (process.platform === "win32"
        ? join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
        : execFileSync("python3", ["-I", "-B", "-c", "import sys; print(sys.executable)"], {
          encoding: "utf8", env: { ...process.env, PYTHON_MANAGER_AUTOMATIC_INSTALL: "false" }, timeout: 10_000 }).trim());
      assert.ok(existsSync(python), "An existing explicit Python interpreter is required; this fixture never installs one");
      const keys = generateKeyPairSync("ed25519");
      const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
      const publicKeyFile = join(root, "fixture-verifier.pub"); writeFileSync(publicKeyFile, publicKey);
      const text = "Implement two pinned local add artifacts";
      const goal = { title: text, description: text, successCriteria: ["First exact add artifact", "Second exact add artifact"], constraints: ["Local artifacts only; no release"] };
      const sequence = { version: 1, goalDigest: residentDevelopmentGoalDigest(goal), taskScopeId: "issue:1219", maxRisk: "low",
        completionMode: "verified-local-artifact", expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        jobs: ["a", "b"].map((key, index) => ({ key, objective: "Implement add(a, b) returning a + b", criterionIds: [`criterion-${index + 1}`],
          targetFiles: [localOllamaFixtureSourcePath, localOllamaFixtureTestPath], baseRevision })) };
      const executions = ["a", "b"].map((key, index) => ({ key, workspace: workspaces[index]!, targetPath: localOllamaFixtureSourcePath,
        allowedFiles: [localOllamaFixtureSourcePath, localOllamaFixtureTestPath], receiptFile: join(root, `receipt-${key}.json`),
        publicKeyFile, publicKeySha256: sha(publicKey), tddProfile: "python_add_v1", acceptance: [{ criterionId: `criterion-${index + 1}`,
          description: goal.successCriteria[index]!, expectedFiles: [{ path: localOllamaFixtureSourcePath, sha256: sha(content) }] }] }));
      const manifest = JSON.stringify({ version: 1, sequence, executions }), manifestFile = join(root, "manifest.json");
      writeFileSync(manifestFile, manifest);
      mockOllama.listen(0, "127.0.0.1"); await once(mockOllama, "listening");
      const modelPort = (mockOllama.address() as { port: number }).port;
      const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
      const port = (socket.address() as { port: number }).port; await new Promise<void>(r => socket.close(() => r()));
      assert.ok(![8787, 8796, 8797].includes(port) && ![8787, 8796, 8797].includes(modelPort));
      const ownerToken = "broker-sequence-test-owner", url = `http://127.0.0.1:${port}/api/jarvis/admin`;
      const headers = { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" };
      const telemetryPreload = pathToFileURL(join(repositoryRoot, "tests", "helpers", "resource-telemetry-preload.mjs")).href;
      const resourceState = join(root, "resource-state"); mkdirSync(resourceState);
      const env = { ...process.env, LOCALAPPDATA: root, XDG_STATE_HOME: resourceState,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${telemetryPreload}`.trim(),
        GITHUB_TOKEN: "", CODE_BUILDER_LOCAL_URL: "", CODE_BUILDER_LOCAL_TOKEN: "",
        JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: ownerToken,
        JARVIS_DB_PATH: join(root, "broker.db"), JARVIS_COMPASS_DB_PATH: compassPath,
        JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "",
        GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE: manifestFile, GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256: sha(manifest),
        GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "1", GAI_LOCAL_MODEL_NAME: "fixture-model", GAI_LOCAL_MODEL_ENDPOINT: `http://127.0.0.1:${modelPort}`,
        GORIQ_LOCAL_TDD_PYTHON: realpathSync(python), PYTHON_MANAGER_AUTOMATIC_INSTALL: "false" };
      const startBroker = () => {
        child = spawn(process.execPath, [join(repositoryRoot, "scripts", "jarvis-broker.ts")], {
          cwd: repositoryRoot, env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
        child.stderr?.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-12_000); });
      };
      const waitFor = async (label: string, check: () => Promise<boolean>, limit = 55_000) => {
        const deadline = Date.now() + limit;
        while (Date.now() < deadline) {
          if (child?.exitCode !== null && child?.exitCode !== undefined) assert.fail(`${label}: Broker exited ${child.exitCode}: ${diagnostics}`);
          if (await check()) return;
          await delay(150);
        }
        assert.fail(`${label}: timed out; generations=${generations}; ${diagnostics}`);
      };
      const ready = () => waitFor("Broker startup", async () => {
        try { return (await fetch(`${url}/bridge/events`, { headers, signal: AbortSignal.timeout(1000) })).ok; }
        catch { return false; }
      });
      startBroker(); await ready();
      const payload = { text, goalContract: { successCriteria: goal.successCriteria, constraints: goal.constraints }, idempotencyKey: "fixture-goal-create" };
      const denied = await fetch(`${url}/work`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      assert.equal(denied.status, 401); assert.equal(generations, 0);
      const unacceptedDb = new CompassStore(compassPath);
      try { assert.equal(unacceptedDb.getGoal(), null); } finally { unacceptedDb.close(); }
      const accepted = await fetch(`${url}/work`, { method: "POST", headers, body: JSON.stringify(payload) });
      assert.equal(accepted.status, 202);
      const acceptance = await accepted.json() as { accepted: boolean; executionScheduled: boolean; goalId: string; remainingCriteria: string[] };
      assert.equal(acceptance.accepted, true); assert.equal(acceptance.executionScheduled, true);
      assert.deepEqual(acceptance.remainingCriteria, ["criterion-1", "criterion-2"]);
      const goalId = acceptance.goalId, stateRoot = join(root, "state", "self-development");
      const jobs = () => new JsonFileDevelopmentJobStore(join(stateRoot, "jobs.json")).getByGoal(goalId);
      const status = async () => {
        const response = await fetch(`${url}/work/${encodeURIComponent(goalId)}`, { headers, signal: AbortSignal.timeout(2000) });
        assert.equal(response.status, 200);
        const body = await response.json() as { run: { phase: string; nextAction: string; blockers: string[] } };
        assert.ok(!["BLOCKED", "HUMAN_GATE", "FAILED"].includes(body.run.phase), JSON.stringify(body.run) + diagnostics);
        return body.run;
      };
      await waitFor("first signed receipt wait", async () => (await status()).nextAction === "verification_wait" && (await jobs()).length === 1);
      const probeRecords = readFileSync(join(resourceState, "fixture-resource-probes.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.ok(probeRecords.length > 0);
      assert.ok(probeRecords.every(record => record.evidenceKind === "TEST_DOUBLE_NOT_NATIVE_RESOURCES"));
      assert.equal(generations, 1); assert.equal((await jobs())[0]!.phase, "VERIFYING");
      const firstBrokerPid = child!.pid;
      await delay(250); await stopBroker(); startBroker(); await ready();
      assert.notEqual(child!.pid, firstBrokerPid);
      await waitFor("restart preserves first candidate", async () => (await status()).nextAction === "verification_wait");
      assert.equal(generations, 1);
      const putReceipt = async (index: number) => {
        const job = (await jobs())[index]!; assert.equal(job.phase, "VERIFYING");
        const changeSet = (await new JsonFileDevelopmentChangeSetStore(join(stateRoot, "change-sets.json")).list())
          .find(item => item.jobId === job.jobId && item.workItemId.endsWith(":implement"))!;
        const plan = createDevelopmentVerificationPlan({ builderId: changeSet.deviceId, sourceRevision: changeSet.candidateRevision,
          artifactDigest: changeSet.artifactDigest, changedPaths: changeSet.changedPaths });
        const issuedAt = new Date().toISOString();
        const receipt: SignedLocalVerifierPayload = { version: 1, verifierId: "fixture-signer-not-a-separate-principal", goalId, jobId: job.jobId,
          changeSetId: changeSet.changeSetId, builderId: changeSet.deviceId, baseRevision, sourceRevision: changeSet.candidateRevision,
          artifactDigest: changeSet.artifactDigest, issuedAt, expiresAt: new Date(Date.now() + 600_000).toISOString(),
          checks: plan.requiredChecks.map(check => ({ check, status: "passed", outputDigest: sha(check), recordedAt: issuedAt })) };
        writeFileSync(executions[index]!.receiptFile, JSON.stringify({ payload: receipt,
          signatureBase64: sign(null, Buffer.from(canonicalLocalVerifierPayload(receipt)), keys.privateKey).toString("base64") }));
      };
      await putReceipt(0);
      await waitFor("automatic second Job and signed receipt wait", async () => {
        const run = await status(), persisted = await jobs();
        return run.nextAction === "verification_wait" && persisted.length === 2 && persisted[0]!.phase === "COMPLETED" && persisted[1]!.phase === "VERIFYING";
      });
      assert.equal(generations, 2);
      await putReceipt(1);
      await waitFor("signed second artifact completion", async () => (await status()).phase === "COMPLETED");
      assert.deepEqual((await jobs()).map(job => job.phase), ["COMPLETED", "COMPLETED"]);
      assert.equal(generations, 2);
      const progressResponse = await fetch(`${url}/work`, { method: "POST", headers,
        body: JSON.stringify({ text: "Continue pinned local artifacts", goalHint: goalId, idempotencyKey: "fixture-final-progress" }) });
      assert.equal(progressResponse.status, 202);
      const final = await progressResponse.json() as { remainingCriteria: string[]; executionScheduled: boolean };
      assert.deepEqual(final.remainingCriteria, []); assert.equal(final.executionScheduled, false); assert.equal(generations, 2);
      const db = new CompassStore(compassPath);
      try {
        const state = await new CompassWorkStateStoreAdapter(db).get(goalId);
        assert.equal(state?.status, "COMPLETED"); assert.deepEqual(state?.verificationResults.map(item => item.itemId), ["criterion-1", "criterion-2"]);
      } finally { db.close(); }
      for (const workspace of workspaces) assert.equal(readFileSync(join(workspace, localOllamaFixtureSourcePath), "utf8"), content);
    } finally {
      await stopBroker(); mockOllama.closeAllConnections(); await new Promise<void>(r => mockOllama.close(() => r()));
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true });
    }
  });
