import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import { generateKeyPairSync, createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname, resolve, delimiter } from "node:path";
import { attestLocalCandidate } from "../scripts/jarvis-independent-artifact-attestation.mjs";
import { runIndependentVerifier } from "../scripts/jarvis-independent-check-runner.mjs";
import { prepareOfflineVerifierWorkspace } from "../scripts/jarvis-verifier-offline-workspace.mjs";

// Only the unavailable container boundary is doubled. Git, file staging,
// identity, ephemeral test signing and persisted receipts are real.
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "goriq-runner-snapshot-"));
  const repo = join(root, "repo"), candidate = join(root, "candidate"), runner = join(root, "runner");
  const git = (cwd, ...args) => childProcess.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  fs.mkdirSync(repo);
  git(repo, "init");
  git(repo, "config", "user.name", "Verifier fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "core.autocrlf", "false");
  fs.mkdirSync(join(repo, "docs"));
  fs.writeFileSync(join(repo, "docs/.gitkeep"), "base\n");
  fs.writeFileSync(join(repo, ".gitignore"), ".jarvis/\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture base");
  git(repo, "worktree", "add", "--detach", candidate, "HEAD");
  git(repo, "worktree", "add", "--detach", runner, "HEAD");
  fs.writeFileSync(join(candidate, "docs/result.txt"), "implementation\n");
  fs.writeFileSync(join(candidate, "docs/check.txt"), "trusted assertion\n");
  const baseRevision = git(repo, "rev-parse", "HEAD");
  const scope = { workspace: candidate, baseRevision, targetPath: "docs/result.txt",
    allowedUntracked: ["docs/result.txt", "docs/check.txt"] };
  const identity = attestLocalCandidate(scope);
  const privateKeyFile = join(root, "fixture-only.pem"), receiptFile = join(root, "receipt.json");
  fs.writeFileSync(privateKeyFile, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
  const req = { goalId: "g", jobId: "j", changeSetId: "c", builderId: "builder", verifierId: "verifier",
    baseRevision, sourceRevision: identity.candidateRevision, artifactDigest: identity.artifactDigest,
    targetPath: scope.targetPath, allowedUntracked: scope.allowedUntracked, requiredChecks: ["unit"],
    candidateWorkspace: candidate, verifierWorkspace: runner, privateKeyFile, receiptFile };
  const savedEnv = [process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED, process.env.GORIQ_VERIFIER_CONTAINER_IMAGE];
  const savedPath=process.env.PATH;
  const bin=join(root,"bin");
  fs.mkdirSync(bin);
  const dockerFile=join(bin,process.platform==="win32"?"docker.exe":"docker");
  fs.writeFileSync(dockerFile,"test boundary only",{mode:0o755});
  process.env.PATH=bin+delimiter+savedPath;
  process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED = "1";
  process.env.GORIQ_VERIFIER_CONTAINER_IMAGE = "fixture@sha256:" + "a".repeat(64);
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    process.env.PATH=savedPath;
    for (const [i, name] of ["GORIQ_VERIFIER_OPERATOR_ISOLATED", "GORIQ_VERIFIER_CONTAINER_IMAGE"].entries()) {
      if (savedEnv[i] === undefined) delete process.env[name]; else process.env[name] = savedEnv[i];
    }
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.includes("goriq-runner-snapshot-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const calls = [];
  const docker = (effect = () => {}, expectedExecutable = dockerFile) => {
    t.mock.method(childProcess, "spawn", (command, args) => {
      assert.equal(command, expectedExecutable);
      calls.push({ command, args });
      const child=new EventEmitter();
      child.stdout=new PassThrough();child.stderr=new PassThrough();
      child.kill=()=>true;child.unref=()=>{};
      globalThis.queueMicrotask(()=>{
        let output = {};
        if(args[0]==="run"){
          assert.ok(args.includes("--network=none"));
          output = effect(args) ?? {};
          child.stdout.write(output.stdout ?? "fixture stdout");
          child.stderr.write(output.stderr ?? "");
        }
        child.stdout.end();child.stderr.end();child.emit("close",output.status ?? 0,null);
      });
      return child;
    });
    syncBuiltinESMExports();
  };
  return { root, candidate, runner, req, docker, calls };
}

test("ignored candidate Docker executable cannot fabricate six successful checks", async t => {
  const f = fixture(t), unsafeBin = join(f.candidate, ".jarvis", "bin");
  fs.mkdirSync(unsafeBin, { recursive: true });
  const unsafeExecutable = join(unsafeBin, process.platform === "win32" ? "docker.exe" : "docker");
  fs.writeFileSync(unsafeExecutable, "candidate-owned fake Docker", { mode: 0o755 });
  process.env.PATH = unsafeBin + delimiter + process.env.PATH;
  f.docker(() => ({ stdout: "NO_CONTAINER_OR_CHECK_EXECUTED" }), unsafeExecutable);
  const result = await runIndependentVerifier({ ...f.req,
    requiredChecks: ["lint", "typecheck", "unit", "integration", "security", "build"] });
  assert.equal(result.verified, false, "a candidate-owned CLI must not manufacture a signed all-checks success");
  assert.equal(f.calls.length, 0, "reject before run or cleanup can execute the candidate CLI");
  assert.deepEqual(result.checks.map(check => check.status), ["inconclusive"]);
  const log = JSON.parse(fs.readFileSync(join(f.req.receiptFile + ".logs", "lint.json")));
  assert.equal(log.errorCode, "VERIFIER_CONTAINER_EXECUTABLE_IN_WORKSPACE");
  const receipt = JSON.parse(fs.readFileSync(f.req.receiptFile, "utf8"));
  assert.equal(receipt.payload.checks.some(check => check.status === "passed"), false);
});

test("runner refuses a support file swapped during staging before any container starts", async t => {
  const f = fixture(t), originalCopy = fs.copyFileSync;
  let launched = false;
  f.docker(() => { launched = true; });
  t.mock.method(fs, "copyFileSync", (source, target, flags) => {
    if (source.endsWith("check.txt")) fs.writeFileSync(source, "substituted assertion\n");
    return originalCopy(source, target, flags);
  });
  syncBuiltinESMExports();
  await assert.rejects(() => runIndependentVerifier(f.req), /STAGING_MISMATCH/);
  assert.equal(launched, false);
  assert.equal(fs.existsSync(f.req.receiptFile), false);
});

test("runner refuses candidate support-file substitution during a check", async t => {
  const f = fixture(t);
  f.docker(() => fs.writeFileSync(join(f.candidate, "docs/check.txt"), "substituted\n"));
  await assert.rejects(() => runIndependentVerifier(f.req), /CANDIDATE_CHANGED_DURING_EXECUTION/);
  assert.equal(fs.existsSync(f.req.receiptFile), false);
});

test("runner refuses staged support-file substitution during a check", async t => {
  const f = fixture(t);
  f.docker(() => fs.writeFileSync(join(f.runner, "docs/check.txt"), "substituted\n"));
  await assert.rejects(() => runIndependentVerifier(f.req), /RUNNER_CHANGED_DURING_EXECUTION/);
  assert.equal(fs.existsSync(f.req.receiptFile), false);
});

test("external ancestor alias into a workspace is refused before signing-key loading", async t => {
  const f = fixture(t), hidden = join(f.runner, ".jarvis"), alias = join(f.root, "alias");
  fs.mkdirSync(hidden);
  fs.writeFileSync(join(hidden, "not-a-key.pem"), "not a key");
  fs.symlinkSync(hidden, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => runIndependentVerifier({ ...f.req, privateKeyFile: join(alias, "not-a-key.pem") }),
    /EXTERNAL_PATH_UNSAFE|KEY_OR_RECEIPT_IN_WORKSPACE/);
});

test("signed output digest identifies a retained bounded log and complete file manifest", async t => {
  const f = fixture(t);
  f.docker();
  const result = await runIndependentVerifier(f.req);
  assert.equal(result.verified, true);
  const receipt = JSON.parse(fs.readFileSync(f.req.receiptFile, "utf8"));
  const bytes = fs.readFileSync(join(f.req.receiptFile + ".logs", "unit.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), receipt.payload.checks[0].outputDigest);
  const log = JSON.parse(bytes);
  assert.equal(log.stdout, "fixture stdout");
  assert.equal(log.containerImage, "fixture@sha256:" + "a".repeat(64));
  assert.equal(log.sourceRevision, f.req.sourceRevision);
  assert.equal(log.cleanup.confirmed,true);
  assert.deepEqual(Object.keys(log.fileHashes).sort(), ["docs/check.txt", "docs/result.txt"]);
});

test("execution snapshot excludes ignored workspace files and Git metadata", async t => {
  const f = fixture(t);
  fs.mkdirSync(join(f.runner, ".jarvis"));
  fs.writeFileSync(join(f.runner, ".jarvis/never-export.txt"), "private fixture data");
  f.docker(args => {
    const mount = args[args.indexOf("--mount") + 1];
    const snapshot = mount.match(/source=(.*),target=/)[1];
    assert.equal(fs.existsSync(join(snapshot, ".jarvis/never-export.txt")), false);
    assert.equal(fs.existsSync(join(snapshot, ".git")), false);
    assert.equal(fs.readFileSync(join(snapshot, "docs/check.txt"), "utf8"), "trusted assertion\n");
  });
  assert.equal((await runIndependentVerifier(f.req)).verified, true);
});

test("container must prepare matching offline dependencies with the image-owned helper before a check", async t => {
  const f = fixture(t);
  let script;
  f.docker(args => { script = args.at(-1); });
  await runIndependentVerifier(f.req);
  assert.equal(script, "node /opt/goriq-verifier/jarvis-verifier-offline-workspace.mjs && cd /tmp/verify && exec pnpm test");
});

test("writable temporary storage is private to the unprivileged verifier and remains noexec", async t => {
  const f = fixture(t);
  let mount;
  f.docker(args => { mount = args[args.indexOf("--tmpfs") + 1]; });
  assert.equal((await runIndependentVerifier(f.req)).verified, true);
  const options = mount.slice("/tmp:".length).split(",");
  for (const option of ["rw", "noexec", "nosuid", "nodev", "uid=65534", "gid=65534", "mode=0700", "size=1536m"])
    assert.ok(options.includes(option), "missing temporary boundary: " + option);
  assert.equal(options.includes("exec"), false);
});

test("build receipt log records the fixed supported production Webpack profile", async t => {
  const f = fixture(t);
  f.docker();
  assert.equal((await runIndependentVerifier({ ...f.req, requiredChecks: ["build"] })).verified, true);
  const log = JSON.parse(fs.readFileSync(join(f.req.receiptFile + ".logs", "build.json"), "utf8"));
  assert.deepEqual(log.args, ["build", "--webpack"]);
  assert.equal(log.executionProfile, "next-webpack-v1");
});

test("offline bundle refusal is retained as a failed signed check with no later checks", async t => {
  const f = fixture(t);
  f.docker(args => {
    const source = args[args.indexOf("--mount") + 1].match(/source=(.*),target=/)[1];
    // Execute the real preparation logic against the exported snapshot. Only
    // Docker is unavailable in this fixture; no package manager is executed.
    try {
      prepareOfflineVerifierWorkspace({ source, dependencies: join(f.root, "missing-image-bundle"),
        destination: join(f.root, "container-tmp") });
      return { status: 0 };
    } catch (error) { return { status: 1, stderr: String(error.message) }; }
  });
  const result = await runIndependentVerifier({ ...f.req, requiredChecks: ["unit", "build"] });
  assert.equal(result.verified, false);
  assert.deepEqual(result.checks.map(check => [check.check, check.status]), [["unit", "failed"]]);
  const receipt = JSON.parse(fs.readFileSync(f.req.receiptFile, "utf8"));
  const logBytes = fs.readFileSync(join(f.req.receiptFile + ".logs", "unit.json"));
  assert.equal(receipt.payload.checks[0].outputDigest, createHash("sha256").update(logBytes).digest("hex"));
  assert.match(JSON.parse(logBytes).stderr, /VERIFIER_OFFLINE_DEPENDENCIES_MISSING/);
  assert.equal(fs.existsSync(join(f.req.receiptFile + ".logs", "build.json")), false);
});

for (const requiredChecks of [["unit"], ["unit", "build"]]) {
  test(`an expired request stops before ${requiredChecks.length === 1 ? "signing" : "the next check"}`, async t => {
    const f = fixture(t), deadline = Date.now() + 60_000;
    let launches = 0;
    f.docker(() => {
      launches++;
      t.mock.method(Date, "now", () => deadline + 1);
    });
    await assert.rejects(() => runIndependentVerifier({ ...f.req, requiredChecks,
      expiresAt: new Date(deadline).toISOString() }), /VERIFIER_REQUEST_EXPIRED/);
    assert.equal(launches, 1);
    assert.equal(fs.existsSync(f.req.receiptFile), false);
    assert.equal(fs.existsSync(join(f.req.receiptFile + ".logs", "unit.json")), true);
    assert.equal(fs.existsSync(join(f.req.receiptFile + ".logs", "build.json")), false);
  });
}

test("a signed receipt cannot outlive the portable request deadline", async t => {
  const f = fixture(t), expiresAt = new Date(Date.now() + 60_000).toISOString();
  f.docker();
  assert.equal((await runIndependentVerifier({ ...f.req, expiresAt })).verified, true);
  assert.equal(JSON.parse(fs.readFileSync(f.req.receiptFile, "utf8")).payload.expiresAt, expiresAt);
});

test("restricted signer umask leaves the export readable but logs private", {skip:process.platform==="win32"}, async t => {
  const f=fixture(t),mask=process.umask(0o077);
  try{
    f.docker(args=>{
      const snapshot=args[args.indexOf("--mount")+1].match(/source=(.*),target=/)[1];
      assert.equal(fs.statSync(snapshot).mode&0o777,0o755);
      assert.equal(fs.statSync(join(snapshot,"docs")).mode&0o777,0o755);
      assert.equal(fs.statSync(join(snapshot,"docs/check.txt")).mode&0o777,0o444);
      assert.equal(fs.statSync(dirname(snapshot)).mode&0o777,0o700);
    });
    assert.equal((await runIndependentVerifier(f.req)).verified,true);
  }finally{process.umask(mask);}
});
