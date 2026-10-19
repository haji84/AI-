import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSequencedResidentRuntime } from "../src/orchestrator/sequenced-resident-runtime.ts";
import { residentDevelopmentGoalDigest } from "../src/orchestrator/resident-development-sequence.ts";
import { localOllamaFixtureSourcePath, localOllamaFixtureTestPath } from "../src/orchestrator/local-ollama-tdd.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { createDevelopmentVerificationPlan } from "../src/orchestrator/development-verification-plan.ts";
import { canonicalLocalVerifierPayload, type SignedLocalVerifierPayload } from "../src/orchestrator/signed-local-verifier-receipt.ts";

test("two bounded local Jobs resume from signed acceptance without rebuilding the completed Job", async t => {
  const root = mkdtempSync(join(tmpdir(), "goriq-sequence-runtime-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, "repo"); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "fixture"); git("config", "core.autocrlf", "false");
  mkdirSync(join(repo, "src")); mkdirSync(join(repo, "tests/fixtures"), { recursive: true });
  writeFileSync(join(repo, "src/.keep"), "fixture\n"); writeFileSync(join(repo, "tests/fixtures/.keep"), "fixture\n");
  git("add", "."); git("commit", "-qm", "fixture"); const base = git("rev-parse", "HEAD");
  const workspaces = [join(root, "job-a"), join(root, "job-b")];
  for (const workspace of workspaces) git("worktree", "add", "--detach", workspace, base);
  const keys = generateKeyPairSync("ed25519"); // Test fixture, never a provisioned verifier identity.
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyFile = join(root, "verifier.pub"); writeFileSync(keyFile, publicKey);
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  const content = "def add(a, b):\n    return a + b\n";
  const goal = { title: "Produce two exact local artifacts", successCriteria: ["first exact artifact", "second exact artifact"], constraints: ["No release"] };
  const sequence = { version: 1, goalDigest: residentDevelopmentGoalDigest(goal), taskScopeId: "issue:1219", maxRisk: "low",
    completionMode: "verified-local-artifact", expiresAt: new Date(Date.now() + 3600000).toISOString(),
    jobs: ["a", "b"].map((key, i) => ({ key, objective: "Implement add(a, b) returning a + b", criterionIds: [`criterion-${i + 1}`], targetFiles: [localOllamaFixtureSourcePath, localOllamaFixtureTestPath], baseRevision: base })) };
  const executions = ["a", "b"].map((key, i) => ({ key, workspace: workspaces[i]!, targetPath: localOllamaFixtureSourcePath,
    allowedFiles: [localOllamaFixtureSourcePath, localOllamaFixtureTestPath], receiptFile: join(root, `receipt-${key}.json`), publicKeyFile: keyFile,
    publicKeySha256: sha(publicKey), tddProfile: "python_add_v1", acceptance: [{ criterionId: `criterion-${i + 1}`, description: goal.successCriteria[i]!, expectedFiles: [{ path: localOllamaFixtureSourcePath, sha256: sha(content) }] }] }));
  const manifestFile = join(root, "manifest.json"), manifest = JSON.stringify({ version: 1, sequence, executions }); writeFileSync(manifestFile, manifest);
  const env = { GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE: manifestFile, GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256: sha(manifest),
    GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "1", GAI_LOCAL_MODEL_NAME: "test-fixture-model" };
  let generations = 0;
  const fetchImpl: typeof fetch = async url => {
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: "test-fixture-model" }] });
    assert.equal(String(url), "http://127.0.0.1:11434/api/generate"); generations++;
    return Response.json({ done: true, model: "test-fixture-model", response: JSON.stringify({ path: localOllamaFixtureSourcePath, content }) });
  };
  const compassPath = join(root, "state", "compass.db"), stateRoot = join(root, "state", "self-development");
  const create = () => createSequencedResidentRuntime({ env, runtimeRoot: repo, compassPath, goal, fetchImpl })!;
  assert.equal(create().matches(goal), true, "explicit pinned sequence must not fall back to another runtime based on keywords");
  assert.throws(() => createSequencedResidentRuntime({ env: { ...env, GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: undefined }, runtimeRoot: repo, compassPath, goal, fetchImpl }), /OPT_IN/);
  assert.equal(createSequencedResidentRuntime({ env: {}, runtimeRoot: repo, compassPath, goal }), null);
  const input = { goalId: "fixture-goal", goal, context: [] };
  let report = await create().run(input);
  assert.equal(report.goalEvaluation?.achieved, false); assert.equal(generations, 1);
  const requestFile = executions[0]!.receiptFile + ".request.json";
  assert.equal(existsSync(requestFile), true, "verification wait must publish the exact candidate request without another Builder call");
  const requestBytes = readFileSync(requestFile);
  const request = JSON.parse(requestBytes.toString("utf8"));
  assert.equal(request.request.goalId, input.goalId);
  assert.equal(request.executionContractDigest, env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256);
  assert.equal(request.files.length, 2);
  assert.deepEqual(request.request.requiredChecks, ["lint", "typecheck", "unit", "integration", "security", "build"]);
  assert.equal(JSON.stringify(request).includes(workspaces[0]!), false, "portable request must not carry host paths or signer authority");
  await create().run(input);
  assert.deepEqual(readFileSync(requestFile), requestBytes, "restart/wake must preserve the same request");
  assert.equal(generations, 1);
  const receipt = async (index: number) => {
    const jobs = await new JsonFileDevelopmentJobStore(join(stateRoot, "jobs.json")).getByGoal(input.goalId);
    const job = jobs[index]!; assert.equal(job.phase, "VERIFYING");
    const changeSet = (await new JsonFileDevelopmentChangeSetStore(join(stateRoot, "change-sets.json")).list()).find(c => c.jobId === job.jobId && c.workItemId.endsWith(":implement"))!;
    const plan = createDevelopmentVerificationPlan({ builderId: changeSet.deviceId, sourceRevision: changeSet.candidateRevision, artifactDigest: changeSet.artifactDigest, changedPaths: changeSet.changedPaths });
    const delivered = JSON.parse(readFileSync(executions[index]!.receiptFile + ".request.json", "utf8")).request;
    assert.equal(delivered.jobId, job.jobId);
    assert.equal(delivered.changeSetId, changeSet.changeSetId);
    assert.equal(delivered.sourceRevision, plan.sourceRevision);
    assert.equal(delivered.artifactDigest, plan.artifactDigest);
    const issuedAt = new Date().toISOString();
    const payload: SignedLocalVerifierPayload = { version: 1, verifierId: "fixture-independent-signer", goalId: delivered.goalId, jobId: delivered.jobId,
      changeSetId: delivered.changeSetId, builderId: delivered.builderId, baseRevision: delivered.baseRevision, sourceRevision: delivered.sourceRevision, artifactDigest: delivered.artifactDigest,
      issuedAt, expiresAt: new Date(Date.now() + 600000).toISOString(), checks: plan.requiredChecks.map(check => ({ check, status: "passed", outputDigest: sha(check), recordedAt: issuedAt })) };
    writeFileSync(executions[index]!.receiptFile, JSON.stringify({ payload, signatureBase64: sign(null, Buffer.from(canonicalLocalVerifierPayload(payload)), keys.privateKey).toString("base64") }));
  };
  await receipt(0);
  report = await create().run(input); // Fresh host simulates process restart, not a physical reboot.
  assert.deepEqual(report.goalEvaluation?.verifiedRequired, ["criterion-1"]); assert.equal(report.goalEvaluation?.achieved, false);
  assert.equal(generations, 1); assert.equal(existsSync(join(workspaces[1]!, localOllamaFixtureSourcePath)), false);
  executions[0]!.acceptance[0]!.expectedFiles[0]!.sha256 = "f".repeat(64);
  const changedManifest = JSON.stringify({ version: 1, sequence, executions });
  writeFileSync(manifestFile, changedManifest);
  env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256 = sha(changedManifest);
  await assert.rejects(() => create().run(input), /SEQUENCE_PERSISTED_JOB_MISMATCH/, "repinned execution contract cannot inherit prior completion");
  assert.equal(generations, 1);
  writeFileSync(manifestFile, manifest); env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256 = sha(manifest);
  report = await create().run(input); assert.equal(generations, 2); assert.equal(report.goalEvaluation?.achieved, false);
  await receipt(1); report = await create().run(input); assert.equal(report.goalEvaluation?.achieved, true);
  report = await create().run(input); assert.equal(report.goalEvaluation?.achieved, true); assert.equal(generations, 2);
  assert.equal(readFileSync(join(workspaces[0]!, localOllamaFixtureSourcePath), "utf8"), content);
});
