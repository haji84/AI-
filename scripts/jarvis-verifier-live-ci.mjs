#!/usr/bin/env node
/** Disposable hosted-CI integration. Test keys and receipts are not physical
 * AI09 principal-separation, native Ollama or Windows-reboot acceptance. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runIndependentVerifier, verifierCommand } from "./jarvis-independent-check-runner.mjs";
import { attestLocalCandidate } from "./jarvis-independent-artifact-attestation.mjs";
import { createDevelopmentVerificationPlan, evaluateDevelopmentVerification } from "../src/orchestrator/development-verification-plan.ts";
import { validateSignedLocalVerifierReceipt } from "../src/orchestrator/signed-local-verifier-receipt.ts";

const CHECKS = ["lint", "typecheck", "unit", "integration", "security", "build"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sortedHashes = hashes => Object.entries(hashes ?? {}).sort(([a], [b]) => a.localeCompare(b));

export function assertHostedVerifierCI({ env = process.env, platform = process.platform, argv = process.argv.slice(2) } = {}) {
  if (argv.length !== 1 || argv[0] !== "--execute-hosted-ci") throw Error("LIVE_EXPLICIT_EXECUTION_REQUIRED");
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux"
    || env.RUNNER_ENVIRONMENT !== "github-hosted" || !isAbsolute(env.RUNNER_TEMP ?? "")
    || env.DOCKER_HOST || env.DOCKER_CONTEXT) throw Error("LIVE_HOSTED_RUNNER_REQUIRED");
}

export function auditLiveVerifierReceipt({ request, publicKeyPem, expectedImage, expectedFileHashes, boundaryMarker }) {
  const bytes = readFileSync(request.receiptFile);
  assert.ok(bytes.length > 0 && bytes.length <= 24_576, "LIVE_RECEIPT_SIZE_INVALID");
  const receipt = JSON.parse(bytes);
  const plan = createDevelopmentVerificationPlan({ builderId: request.builderId,
    sourceRevision: request.sourceRevision, artifactDigest: request.artifactDigest, changedPaths: request.allowedUntracked });
  const evidence = validateSignedLocalVerifierReceipt({ receipt, publicKeyPem, plan, goalId: request.goalId,
    changeSet: { jobId: request.jobId, changeSetId: request.changeSetId,
      baseRevision: request.baseRevision, artifactDigest: request.artifactDigest } });
  assert.deepEqual(receipt.payload.checks.map(c => c.check), CHECKS, "LIVE_CHECK_SET_INVALID");
  assert.equal(receipt.payload.verifierId, request.verifierId, "LIVE_VERIFIER_ID_INVALID");
  assert.ok(evaluateDevelopmentVerification(plan, evidence).passed, "LIVE_CHECK_NOT_PASSED");
  const containers = new Set(), logs = [];
  for (const check of receipt.payload.checks) {
    const file = join(request.receiptFile + ".logs", check.check + ".json");
    assert.ok(statSync(file).size <= 16 * 1024 * 1024, "LIVE_LOG_SIZE_INVALID");
    const logBytes = readFileSync(file);
    assert.equal(hash(logBytes), check.outputDigest, "LIVE_LOG_DIGEST_MISMATCH");
    const log = JSON.parse(logBytes), [command, args] = verifierCommand(check.check);
    assert.ok(log.sourceRevision === request.sourceRevision && log.containerImage === expectedImage
      && log.command === command && JSON.stringify(log.args) === JSON.stringify(args)
      && JSON.stringify(sortedHashes(log.fileHashes)) === JSON.stringify(sortedHashes(expectedFileHashes)), "LIVE_LOG_BINDING_INVALID");
    assert.ok(log.exit === 0 && log.signal === null && log.closeObserved === true
      && log.errorCode === null && log.runErrorCode === null && log.cleanup?.attempted === true
      && log.cleanup.confirmed === true && /^goriq-verifier-[0-9a-f-]{36}$/.test(log.cleanup.containerName)
      && !containers.has(log.cleanup.containerName) && log.cleanup.removal?.closeObserved === true
      && log.cleanup.removal.errorCode === null && log.cleanup.inspection?.closeObserved === true
      && log.cleanup.inspection.errorCode === null && log.cleanup.inspection.status === 0
      && typeof log.cleanup.inspection.stdout === "string" && log.cleanup.inspection.stdout.trim() === "", "LIVE_LOG_EXECUTION_UNCONFIRMED");
    if (["unit", "integration"].includes(check.check)) {
      assert.ok(typeof boundaryMarker === "string" && boundaryMarker.length > 0
        && log.stdout.includes(boundaryMarker), "LIVE_BOUNDARY_PROBE_MISSING");
    }
    containers.add(log.cleanup.containerName);
    logs.push({ check: check.check, outputDigest: check.outputDigest, containerName: log.cleanup.containerName });
  }
  return { containerExecutionVerified: true, physicalAcceptanceVerified: false,
    receiptSha256: hash(bytes), checks: logs };
}

function boundaryProbe(privateKeyFile, marker) {
  return `import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { accessSync, constants, existsSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
test("real verifier container keeps the Builder away from signer and host", () => {
  assert.equal(process.getuid(), 65534);
  const status = readFileSync("/proc/self/status", "utf8");
  assert.match(status, /^CapEff:\\s+0+$/m);
  assert.match(status, /^NoNewPrivs:\\s+1$/m);
  assert.equal(readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim(), "2147483648");
  assert.equal(readFileSync("/sys/fs/cgroup/pids.max", "utf8").trim(), "128");
  const temporary = lstatSync("/tmp");
  assert.equal(temporary.uid, 65534); assert.equal(temporary.gid, 65534);
  assert.equal(temporary.mode & 0o777, 0o700);
  const mountOptions = readFileSync("/proc/self/mountinfo", "utf8").split("\\n")
    .find(line => line.split(" ")[4] === "/tmp").split(" ")[5].split(",");
  for (const option of ["rw", "nosuid", "nodev", "noexec"]) assert.ok(mountOptions.includes(option));
  const probe = mkdtempSync("/tmp/noexec-boundary-");
  const script = probe + "/native-script", link = probe + "/image-node";
  writeFileSync(script, "#!/bin/sh\\nexit 0\\n", { mode: 0o700, flag: "wx" });
  assert.throws(() => accessSync(script, constants.X_OK), /EACCES/);
  assert.equal(spawnSync(script, [], { timeout: 5000 }).error?.code, "EACCES");
  symlinkSync(process.execPath, link);
  const linked = spawnSync(link, ["--version"], { encoding: "utf8", timeout: 5000 });
  assert.equal(linked.status, 0); assert.equal(linked.stdout.trim(), process.version);
  assert.deepEqual(Object.keys(networkInterfaces()), ["lo"]);
  assert.equal(existsSync("/var/run/docker.sock"), false);
  assert.equal(existsSync(${JSON.stringify(privateKeyFile)}), false);
  assert.equal(process.env.GORIQ_CI_PRIVATE_CANARY, undefined);
  assert.throws(() => writeFileSync("/source/docs/verifier-live-result.txt", "mutated"), /EROFS|EACCES/);
  assert.throws(() => writeFileSync("/opt/goriq-verifier/dependencies/package.json", "mutated"), /EROFS|EACCES/);
  assert.throws(() => writeFileSync("/verifier-root-write-probe", "mutated"), /EROFS|EACCES/);
  process.stdout.write("GORIQ_TMPFS_BOUNDARY:" + JSON.stringify({ uid: temporary.uid, gid: temporary.gid,
    mode: temporary.mode & 0o777, mountOptions, nativeExecutionRejected: true, imageLinkExecuted: true }) + "\\n");
  process.stdout.write(${JSON.stringify(marker + "\n")});
});
`;
}

/** Not called by imports or node --test. The explicit CLI and hosted guard
 * precede every filesystem mutation, image build, key fixture and Docker call. */
async function executeHostedCI() {
  assertHostedVerifierCI();
  const repo = realpathSync(process.cwd()), temporary = realpathSync(process.env.RUNNER_TEMP);
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
    { cwd: repo, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert.equal(realpathSync(git("rev-parse", "--show-toplevel")), repo, "LIVE_REPOSITORY_ROOT_REQUIRED");
  assert.equal(git("status", "--porcelain", "-uall"), "", "LIVE_CLEAN_CHECKOUT_REQUIRED");
  const baseRevision = git("rev-parse", "HEAD"), id = randomUUID();
  const evidenceDirectory = join(temporary, "goriq-verifier-live-evidence");
  mkdirSync(evidenceDirectory, { mode: 0o700 }); // exclusive: never overwrite an old run
  const root = mkdtempSync(join(temporary, "goriq-verifier-live-"));
  const candidate = join(root, "candidate"), runner = join(root, "runner"), receiptFile = join(root, "receipt.json");
  const privateKeyFile = join(root, "ephemeral-ci-signer.pem"), registryName = "goriq-ci-registry-" + id;
  const registryImage = "registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";
  const dockerEnv = { PATH: process.env.PATH, HOME: join(root, "home"), DOCKER_CONFIG: join(root, "docker-config") };
  mkdirSync(dockerEnv.HOME, { mode: 0o700 }); mkdirSync(dockerEnv.DOCKER_CONFIG, { mode: 0o700 });
  const docker = (args, timeout = 60_000) => execFileSync("docker", args,
    { env: dockerEnv, cwd: root, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const writeEvidence = (name, value) => writeFileSync(join(evidenceDirectory, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  let registryAttempted = false, image, outcome = { status: "FAILED", physicalAcceptanceVerified: false, baseRevision };
  const savedEnv = Object.fromEntries(["GORIQ_VERIFIER_OPERATOR_ISOLATED", "GORIQ_VERIFIER_CONTAINER_IMAGE", "GORIQ_CI_PRIVATE_CANARY"].map(k => [k, process.env[k]]));
  try {
    // Check the same local default endpoint used by the production runner's
    // deliberately restricted environment; never redirect it to remote Docker.
    assert.equal(docker(["context", "show"]), "default", "LIVE_LOCAL_DOCKER_REQUIRED");
    assert.equal(docker(["context", "inspect", "default", "--format", "{{.Endpoints.docker.Host}}"]),
      "unix:///var/run/docker.sock", "LIVE_LOCAL_DOCKER_REQUIRED");
    const version = JSON.parse(docker(["version", "--format", "{{json .}}"]));
    writeEvidence("environment.json", { evidenceClass: "HOSTED_CONTAINER_CI", physicalAcceptanceVerified: false,
      baseRevision, githubRunId: process.env.GITHUB_RUN_ID, node: process.version,
      registryImage, dockerClient: version.Client.Version, dockerServer: version.Server.Version,
      limits: { timeoutMs: 180_000, memoryBytes: 2147483648, pids: 128, tmpfsMiB: 1536, network: "none", uid: 65534 } });
    const context = join(root, "image-context"); mkdirSync(context, { mode: 0o700 });
    for (const file of ["package.json", "pnpm-lock.yaml"]) copyFileSync(join(repo, file), join(context, file));
    copyFileSync(join(repo, "scripts/jarvis-verifier-offline-workspace.mjs"), join(context, "jarvis-verifier-offline-workspace.mjs"));
    copyFileSync(join(repo, "tests/fixtures/verifier-image/Dockerfile"), join(context, "Dockerfile"));
    const tag = "goriq-verifier-ci:" + id;
    process.stdout.write("LIVE_STAGE:build-image\n");
    docker(["build", "--pull=false", "--tag", tag, context], 8 * 60_000);
    docker(["pull", registryImage], 120_000);
    // Fixture registry exists only on this disposable runner's loopback. The
    // actual six-check containers still have --pull=never and --network=none.
    registryAttempted = true; // cleanup also covers a CLI timeout after creation
    docker(["run", "--detach", "--rm", "--name", registryName, "--publish", "127.0.0.1::5000",
      "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=2g",
      "--tmpfs", "/var/lib/registry:rw,nosuid,nodev,size=2048m", registryImage]);
    const address = docker(["port", registryName, "5000/tcp"]);
    assert.match(address, /^127\.0\.0\.1:[0-9]+$/, "LIVE_REGISTRY_NOT_LOOPBACK");
    const localTag = address + "/verifier:" + id;
    docker(["tag", tag, localTag]); docker(["push", localTag], 180_000);
    const digests = JSON.parse(docker(["image", "inspect", localTag, "--format", "{{json .RepoDigests}}"]));
    image = digests.find(d => d.startsWith(address + "/verifier@sha256:"));
    assert.match(image ?? "", /^127\.0\.0\.1:[0-9]+\/verifier@sha256:[a-f0-9]{64}$/, "LIVE_REPOSITORY_DIGEST_MISSING");
    docker(["pull", image], 180_000);
    assert.equal(docker(["image", "inspect", image, "--format", "{{.Id}}"]),
      docker(["image", "inspect", tag, "--format", "{{.Id}}"]), "LIVE_IMAGE_ID_MISMATCH");
    writeEvidence("image.json", { image, buildContextHashes: Object.fromEntries(readdirSync(context).sort()
      .map(name => [name, hash(readFileSync(join(context, name)))])) });
    git("worktree", "add", "--detach", candidate, baseRevision);
    git("worktree", "add", "--detach", runner, baseRevision);
    const targetPath = "docs/verifier-live-result.txt", probePath = "tests/verifier-ci-boundary-probe.test.mjs";
    const boundaryMarker = "GORIQ_REAL_BOUNDARY_PROBE_PASS:" + id;
    writeFileSync(join(candidate, targetPath), "Full repository real-container CI candidate\n", { flag: "wx" });
    writeFileSync(join(candidate, probePath), boundaryProbe(privateKeyFile, boundaryMarker), { flag: "wx" });
    const identity = attestLocalCandidate({ workspace: candidate, baseRevision, targetPath, allowedUntracked: [targetPath, probePath] });
    const keys = generateKeyPairSync("ed25519"), publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    writeFileSync(privateKeyFile, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
    writeFileSync(join(evidenceDirectory, "public-key.pem"), publicKeyPem, { flag: "wx", mode: 0o600 });
    const request = { goalId: "ci-goal-" + id, jobId: "ci-job-" + id, changeSetId: "ci-change-" + id,
      builderId: "ci-untrusted-container", verifierId: "ci-host-signer", baseRevision,
      sourceRevision: identity.candidateRevision, artifactDigest: identity.artifactDigest,
      targetPath, allowedUntracked: [targetPath, probePath], requiredChecks: [...CHECKS],
      candidateWorkspace: candidate, verifierWorkspace: runner, privateKeyFile, receiptFile };
    // This acknowledgement is scoped to ephemeral CI keys only. It is never
    // evidence of provisioned AI09 production signer/Builder OS principals.
    process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED = "1";
    process.env.GORIQ_VERIFIER_CONTAINER_IMAGE = image;
    process.env.GORIQ_CI_PRIVATE_CANARY = randomUUID();
    process.stdout.write("LIVE_STAGE:six-real-checks\n");
    const result = await runIndependentVerifier(request);
    writeEvidence("runner-result.json", result);
    const audited = auditLiveVerifierReceipt({ request, publicKeyPem, expectedImage: image,
      expectedFileHashes: identity.fileHashes, boundaryMarker });
    assert.equal(result.verified, true, "LIVE_RUNNER_NOT_VERIFIED");
    outcome = { ...outcome, status: "PASSED", ...audited, image,
      goalId: request.goalId, jobId: request.jobId, changeSetId: request.changeSetId,
      sourceRevision: identity.candidateRevision, artifactDigest: identity.artifactDigest,
      publicKeySha256: hash(publicKeyPem) };
  } catch (error) {
    outcome = { ...outcome, status: "FAILED", image: image ?? null,
      error: String(error.message).slice(0, 1000) };
    // Preserve bounded Docker build/setup diagnostics without uploading any
    // workspace, Docker config, environment dump or ephemeral private key.
    if (error.stderr) writeFileSync(join(evidenceDirectory, "setup-error.log"), String(error.stderr).slice(-64_000), { mode: 0o600 });
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const cleanupErrors = [];
    try {
      if (existsSync(receiptFile)) copyFileSync(receiptFile, join(evidenceDirectory, "receipt.json"));
      const logs = receiptFile + ".logs";
      if (existsSync(logs)) {
        mkdirSync(join(evidenceDirectory, "checks"), { mode: 0o700 });
        for (const check of CHECKS) if (existsSync(join(logs, check + ".json")))
          copyFileSync(join(logs, check + ".json"), join(evidenceDirectory, "checks", check + ".json"));
      }
    } catch (error) { cleanupErrors.push("retain-evidence:" + String(error.message).slice(0, 500)); }
    try {
      if (registryAttempted) {
        // --rm can already have removed the fixture. Only a successful empty
        // daemon listing confirms absence; rm exit1 alone establishes nothing.
        try { docker(["rm", "--force", "--volumes", registryName]); } catch { /* Confirm below. */ }
        assert.equal(docker(["container", "ls", "--all", "--filter", "name=^/" + registryName + "$", "--format", "{{.Names}}"]),
          "", "LIVE_REGISTRY_CLEANUP_UNCONFIRMED");
      }
    } catch (error) { cleanupErrors.push("registry:" + String(error.message).slice(0, 500)); }
    try {
      assert.equal(dirname(realpathSync(root)), temporary, "LIVE_CLEANUP_ROOT_INVALID");
      assert.ok(basename(root).startsWith("goriq-verifier-live-"), "LIVE_CLEANUP_ROOT_INVALID");
      for (const path of [candidate, runner]) if (existsSync(path)) git("worktree", "remove", "--force", path);
      rmSync(root, { recursive: true });
    } catch (error) { cleanupErrors.push("filesystem:" + String(error.message).slice(0, 500)); }
    outcome.fixtureCleanupConfirmed = cleanupErrors.length === 0;
    if (cleanupErrors.length) outcome = { ...outcome, status: "FAILED", cleanupErrors };
    writeEvidence("result.json", outcome);
    process.stdout.write(JSON.stringify(outcome) + "\n");
  }
  assert.equal(outcome.status, "PASSED", "LIVE_VERIFIER_CI_FAILED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await executeHostedCI(); }
  catch (error) { process.stderr.write("LIVE_VERIFIER_STOP:" + String(error.message).slice(0, 1000) + "\n"); process.exitCode = 1; }
}
