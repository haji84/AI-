#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { LocalDevelopmentBuilder } from "../src/orchestrator/local-development-builder.ts";
import {
  assertLoopbackModelEndpoint,
  classifyLocalModelLiveEvidence,
  createBoundedOllamaGenerateRequest,
  parseBoundedLocalModelEdit,
} from "../src/orchestrator/local-model-development-acceptance.ts";
import { ResidentDevelopmentGoalHost } from "../src/orchestrator/resident-development-goal-host.ts";
import { createTaskCompletionAuthorization, normalizeTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";

const exec = promisify(execFile);
const resume = process.argv[2] === "--resume";
const requiredPath = (name) => {
  const value = process.env[name]?.trim();
  if (!value || !isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
};
const workspace = requiredPath("GORIQ_LOCAL_MODEL_WORKSPACE");
const evidenceDir = requiredPath("GORIQ_LOCAL_MODEL_EVIDENCE_DIR");
const repositoryRoot = requiredPath("GORIQ_ACCEPTANCE_REPOSITORY_ROOT");
if (repositoryRoot !== workspace) throw new Error("verification repository must be the exact candidate workspace");
const changeSetFile = join(evidenceDir, "change-sets.json");
const jobFile = join(evidenceDir, "jobs.json");
const counterFile = join(evidenceDir, "model-calls.json");
const authorizationFile = join(evidenceDir, "task-authorization.json");
const acceptanceTestFile = join(evidenceDir, "bounded-acceptance-test.mjs");
const patchFile = join(evidenceDir, "candidate.patch");
const fixture = "tests/fixtures/local-model-self-development.txt";
const expected = "goriq-local-model-pass";
const goalId = "goal-681-real-local-model";
const goal = {
  title: "Implement a bounded local-model repository change",
  description: `Change only ${fixture} using the configured local model`,
  successCriteria: ["independently verified bounded fixture edit"],
  constraints: ["local model only", "publication disabled"],
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const git = async (args) => (await exec("git", args, { cwd: workspace, windowsHide: true, maxBuffer: 1_000_000 })).stdout.trim();

const rel = relative(workspace, resolve(workspace, fixture));
if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("fixture escapes acceptance workspace");

async function releaseState() {
  const persisted = JSON.parse(await readFile(authorizationFile, "utf8"));
  const taskAuthorization = normalizeTaskCompletionAuthorization(persisted.authorization);
  return {
    connected: false,
    taskScopeId: "issue:681",
    taskAuthorization,
    protectedConditions: [],
    classifications: null,
    pullRequest: null,
    mainCi: null,
    deployment: null,
    postDeploymentEvidence: null,
    now: new Date(),
  };
}

const planning = (baseRevision) => ({
  requirementIds: ["CORE-014"],
  baseRevision,
  taskScopeId: "issue:681",
  maxRisk: "low",
  targetFiles: [fixture],
  contextDigest: digest(`goriq-681:${fixture}:${expected}`),
});

async function assertRecovered(baseRevision) {
  if (process.env.GAI_LOCAL_MODEL_NAME || process.env.GAI_LOCAL_MODEL_ENDPOINT) throw new Error("restart verifier must not receive model configuration");
  const jobs = new JsonFileDevelopmentJobStore(jobFile);
  const changeSets = new JsonFileDevelopmentChangeSetStore(changeSetFile);
  const host = new ResidentDevelopmentGoalHost({
    jobs,
    changeSets,
    planning: planning(baseRevision),
    stages: {
      builderId: process.env.GAI_WORKER_ID?.trim() || "zbook",
      async build() { throw new Error("restart attempted a duplicate Builder call"); },
      async verify() { throw new Error("restart attempted duplicate verification"); },
      async acceptanceEvidence() { throw new Error("restart attempted duplicate acceptance evaluation"); },
      async releaseState() { return await releaseState(); },
    },
  });
  await host.run({ goalId, goal, context: [] });
  const job = (await jobs.getByGoal(goalId))[0];
  const implementation = (await changeSets.list()).find((item) => item.jobId === job?.jobId && item.workItemId.endsWith(":implement"));
  if (!job || job.phase !== "READY_TO_PUBLISH" || !implementation || implementation.status !== "READY_TO_PUBLISH") throw new Error("production durable Goal/Job did not resume at READY_TO_PUBLISH");
  const actual = (await readFile(resolve(workspace, fixture), "utf8")).trim();
  const patch = await git(["diff", "--binary", "--"]);
  const calls = JSON.parse(await readFile(counterFile, "utf8"));
  if (actual !== expected || digest(patch) !== implementation.patchDigest || calls.modelCalls !== 1) throw new Error("resumed artifact identity or single-Builder-call invariant failed");
  return { restartResumePassed: true, jobId: job.jobId, changeSetId: implementation.changeSetId, patchDigest: implementation.patchDigest };
}

const baseRevision = await git(["rev-parse", "HEAD"]);
if (resume) {
  process.stdout.write(`${JSON.stringify(await assertRecovered(baseRevision))}\n`);
  process.exit(0);
}

const model = process.env.GAI_LOCAL_MODEL_NAME?.trim();
if (!model) throw new Error("GAI_LOCAL_MODEL_NAME must identify an already installed model");
const origin = assertLoopbackModelEndpoint(process.env.GAI_LOCAL_MODEL_ENDPOINT?.trim() || "http://127.0.0.1:11434");
await mkdir(evidenceDir, { recursive: true });
if ((await git(["status", "--porcelain"])) !== "") throw new Error("acceptance workspace must start clean");
const authorizationText = process.env.GORIQ_TASK_AUTHORIZATION_TEXT?.trim();
if (!authorizationText) throw new Error("GORIQ_TASK_AUTHORIZATION_TEXT must contain the existing owner-approved instruction");
const taskAuthorization = createTaskCompletionAuthorization(authorizationText, { now: new Date() });
if (!taskAuthorization || taskAuthorization.scopeId !== "issue:681") throw new Error("owner-approved task authorization must explicitly name Issue #681");
const authorizationProvenance = {
  actor: process.env.GITHUB_ACTOR?.trim() || "local-contract",
  workflowRunId: process.env.GITHUB_RUN_ID?.trim() || "local-contract",
};
await writeFile(authorizationFile, `${JSON.stringify({ authorization: taskAuthorization, provenance: authorizationProvenance }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
await writeFile(acceptanceTestFile, [
  "import { readFile } from 'node:fs/promises';",
  "const [file, expected] = process.argv.slice(2);",
  "const actual = (await readFile(file, 'utf8')).trim();",
  "if (actual !== expected) { console.error(`expected=${expected} actual=${actual}`); process.exit(1); }",
].join("\n") + "\n", { flag: "wx", mode: 0o600 });

async function boundedJson(url, init, limit = 262_144) {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`local model endpoint returned HTTP ${response.status}`);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength; if (size > limit) throw new Error("local model response exceeds bound");
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizedModelDigest(value) {
  if (typeof value !== "string") return "";
  const raw = value.toLowerCase().replace(/^sha256:/, "");
  return /^[a-f0-9]{64}$/.test(raw) ? `sha256:${raw}` : "";
}

async function inspectOllamaProcess(listenerPort) {
  if (process.platform !== "win32") return null;
  const command = [
    `$connection = Get-NetTCPConnection -State Listen -LocalPort ${listenerPort} | Select-Object -First 1`,
    "if (-not $connection) { throw 'Ollama listener not found' }",
    "$process = Get-Process -Id $connection.OwningProcess",
    `[pscustomobject]@{ pid = $process.Id; executable = $process.Path; listenerPort = ${listenerPort} } | ConvertTo-Json -Compress`,
  ].join("; ");
  const output = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, maxBuffer: 65_536 });
  return JSON.parse(output.stdout.trim());
}

const inventory = await boundedJson(`${origin}/api/tags`, { method: "GET" });
const installed = inventory.models?.find((item) => item.name === model || item.model === model);
if (!installed) throw new Error("configured local model is not installed; no download attempted");
const installedDigest = normalizedModelDigest(installed.digest);
const installedBytes = Number(installed.size ?? 0);
if (!installedDigest || !Number.isFinite(installedBytes) || installedBytes <= 0) throw new Error("installed model artifact provenance is incomplete");
const version = await boundedJson(`${origin}/api/version`, { method: "GET" });
if (typeof version.version !== "string" || !version.version.trim()) throw new Error("Ollama server version provenance is missing");

let modelCalls = 0;
let liveProvenance = null;
let generatedDigest = "";
let redTestExecuted = false;
const verificationExecutions = {};
const localBuilder = new LocalDevelopmentBuilder({
  id: process.env.GAI_WORKER_ID?.trim() || "zbook",
  workspaceRoot: workspace,
  async run(input) {
    if (input.tddPhase === "red") {
      let failureOutput = "";
      try {
        await exec(process.execPath, [acceptanceTestFile, resolve(workspace, fixture), expected], { windowsHide: true, maxBuffer: 65_536 });
        throw new Error("bounded acceptance test unexpectedly passed before implementation");
      } catch (error) {
        if (error instanceof Error && error.message.includes("unexpectedly passed")) throw error;
        failureOutput = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
        redTestExecuted = true;
      }
      return {
        ok: true,
        summary: "bounded acceptance test executed and failed before implementation",
        changedPaths: [fixture],
        patchDigest: digest(`red:${fixture}:${expected}`),
        tddPhase: "red",
        tddEvidenceDigest: digest(`failing-before-model:${failureOutput}`),
      };
    }
    if (modelCalls !== 0) throw new Error("local model Builder was invoked more than once");
    const prompt = [
      "/no_think",
      "Return one JSON object only, with exactly the keys path and content.",
      `Set path exactly to ${fixture}.`,
      `Set content exactly to ${expected}.`,
      "This is a bounded repository-edit proposal. Do not add commentary or any other path.",
    ].join("\n");
    const generated = await boundedJson(`${origin}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createBoundedOllamaGenerateRequest(model, prompt, fixture, expected)),
    });
    modelCalls += 1;
    await writeFile(counterFile, `${JSON.stringify({ modelCalls })}\n`, { flag: "wx", mode: 0o600 });
    if (typeof generated.response !== "string") throw new Error("local model returned no edit proposal");
    generatedDigest = digest(generated.response);
    const proposal = parseBoundedLocalModelEdit(generated.response, fixture, expected);
    await writeFile(resolve(workspace, proposal.path), `${proposal.content}\n`, { flag: "w" });

    const changedPaths = (await git(["diff", "--name-only", "--"])).split(/\r?\n/).filter(Boolean);
    const actual = (await readFile(resolve(workspace, fixture), "utf8")).trim();
    if (changedPaths.length !== 1 || changedPaths[0] !== fixture || actual !== expected) throw new Error("independent file verifier rejected the model edit");
    const patch = await git(["diff", "--binary", "--"]);
    const loadedInventory = await boundedJson(`${origin}/api/ps`, { method: "GET" });
    const loaded = loadedInventory.models?.find((item) => (item.name === model || item.model === model) && normalizedModelDigest(item.digest) === installedDigest);
    const listenerPort = Number(new URL(origin).port || 80);
    const processProof = await inspectOllamaProcess(listenerPort);
    const classification = classifyLocalModelLiveEvidence({
      platform: process.platform,
      githubActions: process.env.GITHUB_ACTIONS === "true",
      runnerEnvironment: process.env.RUNNER_ENVIRONMENT ?? "",
      model: { digest: installedDigest, installedBytes, loaded: Boolean(loaded) },
      processProof,
    });
    liveProvenance = { ...classification, ollamaVersion: version.version, modelDigest: installedDigest, installedBytes, processProof };
    if (process.env.GORIQ_REQUIRE_ADMISSIBLE_REAL_MODEL === "1" && !classification.admissible) throw new Error(`real local-model provenance rejected: ${classification.reasons.join(",")}`);
    return {
      ok: true,
      summary: "configured local model produced the independently verified bounded edit",
      changedPaths,
      patchDigest: digest(patch),
      tddPhase: "green",
      evidence: { model, responseDigest: generatedDigest, liveProvenance },
    };
  },
});

const jobs = new JsonFileDevelopmentJobStore(jobFile);
const changeSets = new JsonFileDevelopmentChangeSetStore(changeSetFile);
const stages = {
  builderId: localBuilder.id,
  async build({ job, workItemId }) {
    const red = workItemId.endsWith(":test");
    const result = await localBuilder.build({
      goalId,
      attemptId: workItemId,
      strategyId: red ? "bounded-red-contract" : "bounded-local-model-edit",
      objective: red ? "persist the failing bounded target" : goal.description,
      files: [fixture],
      context: [],
      baseRevision: job.baseRevision,
      localOnly: true,
      tddPhase: red ? "red" : "green",
    });
    if (!result.ok) throw new Error(`production LocalDevelopmentBuilder rejected the build: ${result.summary}`);
    const envelope = result.evidence?.changeSet;
    if (!envelope || typeof envelope !== "object") throw new Error("production LocalDevelopmentBuilder omitted its Change Set envelope");
    return createDevelopmentChangeSet({
      changeSetId: `${job.jobId}-${red ? "red" : "implementation"}`,
      jobId: job.jobId,
      workItemId,
      deviceId: localBuilder.id,
      baseRevision: job.baseRevision,
      candidateRevision: envelope.candidateRevision,
      changedPaths: envelope.changedPaths,
      affectedSymbols: [],
      patchDigest: envelope.patchDigest,
      artifactDigest: envelope.artifactDigest,
      artifactRef: envelope.artifactRef,
      ...(red ? { tddPhase: "red", tddEvidenceDigest: envelope.tddEvidenceDigest } : {}),
      evidenceDigest: digest(JSON.stringify(result.evidence)),
      rollback: { kind: "git-base", reference: job.baseRevision },
    });
  },
  async verify({ changeSet, plan }) {
    const actual = (await readFile(resolve(workspace, fixture), "utf8")).trim();
    const changedPaths = (await git(["diff", "--name-only", "--"])).split(/\r?\n/).filter(Boolean);
    const patch = await git(["diff", "--binary", "--"]);
    if (!redTestExecuted || actual !== expected || changedPaths.length !== 1 || changedPaths[0] !== fixture || digest(patch) !== changeSet.patchDigest) throw new Error("independent verifier rejected the Builder artifact");
    await writeFile(patchFile, `${patch}\n`, { flag: "wx", mode: 0o600 });
    const runCheck = async (check, command, args) => {
      const completed = await exec(command, args, { cwd: repositoryRoot, windowsHide: true, maxBuffer: 4_000_000 });
      verificationExecutions[check] = { command: [command, ...args].join(" "), outputDigest: digest(`${completed.stdout}\n${completed.stderr}`), passed: true };
    };
    const runPnpm = async (check, args) => process.platform === "win32"
      ? runCheck(check, process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `pnpm ${args.join(" ")}`])
      : runCheck(check, "pnpm", args);
    await runPnpm("lint", ["lint"]);
    await runPnpm("typecheck", ["exec", "tsc", "--noEmit"]);
    await runCheck("unit", process.execPath, ["--test", "tests/goriq-self-development-live-acceptance.test.ts"]);
    await runCheck("integration", process.execPath, ["--test", "tests/goriq-self-development-runtime.test.ts"]);
    await runPnpm("security", ["test:p8-security"]);
    let nextEnv = null;
    try { nextEnv = await readFile(join(repositoryRoot, "next-env.d.ts")); } catch {}
    try { await runPnpm("build", ["build"]); }
    finally { if (nextEnv) await writeFile(join(repositoryRoot, "next-env.d.ts"), nextEnv); }
    await exec(process.execPath, [acceptanceTestFile, resolve(workspace, fixture), expected], { windowsHide: true, maxBuffer: 65_536 });
    await exec("git", ["apply", "--check", "--reverse", patchFile], { cwd: workspace, windowsHide: true, maxBuffer: 65_536 });
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|secret|token)\s*[:=]/i.test(actual)) throw new Error("security verifier rejected credential-like fixture content");
    for (const check of plan.requiredChecks) if (!verificationExecutions[check]?.passed) throw new Error(`required verification was not executed: ${check}`);
    return plan.requiredChecks.map((check) => ({ check, verifierId: "verifier:bounded-exact-file", sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, status: "passed", recordedAt: new Date().toISOString() }));
  },
  async acceptanceEvidence({ job, plan }) {
    if (!redTestExecuted || Object.keys(verificationExecutions).length !== plan.requiredChecks.length) throw new Error("acceptance evidence requested before executed verification");
    if (job.definitionOfDone.length !== 1 || job.definitionOfDone[0]?.description !== goal.successCriteria[0]) throw new Error("unexpected definition of done");
    return job.definitionOfDone.map((criterion) => ({ id: `${job.jobId}:${criterion.id}:acceptance`, criterionId: criterion.id, kind: "acceptance", issuer: "verifier:bounded-exact-file", verified: true, sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, recordedAt: new Date().toISOString() }));
  },
  async releaseState() { return await releaseState(); },
};

const host = new ResidentDevelopmentGoalHost({ jobs, changeSets, stages, planning: planning(baseRevision) });
await host.run({ goalId, goal, context: [] });
const job = (await jobs.getByGoal(goalId))[0];
const changeSet = (await changeSets.list()).find((item) => item.jobId === job?.jobId && item.workItemId.endsWith(":implement"));
if (!job || job.phase !== "READY_TO_PUBLISH" || !changeSet || changeSet.status !== "READY_TO_PUBLISH" || modelCalls !== 1 || !liveProvenance) throw new Error("production durable Goal/Job did not reach READY_TO_PUBLISH");

const childEnv = { ...process.env };
delete childEnv.GAI_LOCAL_MODEL_NAME; delete childEnv.GAI_LOCAL_MODEL_ENDPOINT;
delete childEnv.GORIQ_TASK_AUTHORIZATION_TEXT;
const child = await exec(process.execPath, [fileURLToPath(import.meta.url), "--resume"], { env: childEnv, windowsHide: true, maxBuffer: 131_072 });
const restart = JSON.parse(child.stdout.trim());
const actual = (await readFile(resolve(workspace, fixture), "utf8")).trim();
const evidence = {
  schemaVersion: 2,
  evidenceType: liveProvenance.admissible ? "real-local-model-self-development" : "local-model-contract-smoke",
  admissibleLiveEvidence: liveProvenance.admissible,
  sourceRevision: liveProvenance.admissible ? process.env.GITHUB_SHA : baseRevision,
  workerId: localBuilder.id,
  model,
  modelArtifact: { digest: liveProvenance.modelDigest, installedBytes: liveProvenance.installedBytes },
  inference: { locality: "device", endpointClass: "loopback", ollamaVersion: liveProvenance.ollamaVersion, processProof: liveProvenance.processProof, externalBuilderEnabled: false, publicationEnabled: false },
  modelCalls,
  changedPaths: changeSet.changedPaths,
  verifier: { kind: "file_exact_and_patch_identity", passed: true, expected, actual },
  durableRuntime: { jobId: job.jobId, jobPhase: job.phase, changeSetId: changeSet.changeSetId, changeSetStatus: changeSet.status, patchDigest: changeSet.patchDigest, artifactDigest: changeSet.artifactDigest },
  modelResponseDigest: generatedDigest,
  redTestExecuted,
  verificationExecutions,
  authorization: { source: "workflow_dispatch", ...authorizationProvenance, scopeId: taskAuthorization.scopeId, issuedAt: taskAuthorization.issuedAt, expiresAt: taskAuthorization.expiresAt },
  restartResumePassed: restart.restartResumePassed === true && restart.patchDigest === changeSet.patchDigest,
  readyToPublish: job.phase === "READY_TO_PUBLISH" && changeSet.status === "READY_TO_PUBLISH",
  recordedAt: new Date().toISOString(),
};
if (!evidence.restartResumePassed || !evidence.readyToPublish) throw new Error("restart/publication acceptance failed");
await writeFile(join(evidenceDir, liveProvenance.admissible ? "real-local-model.json" : "contract-smoke.json"), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
