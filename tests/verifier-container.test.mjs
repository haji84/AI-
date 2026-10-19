import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { runVerifierContainer } from "../scripts/jarvis-verifier-container.mjs";

function fixture(t, behavior = {}) {
  const root = mkdtempSync(join(tmpdir(), "goriq-container-boundary-"));
  const bin = join(root, "bin"), cwd = join(root, "workspace");
  mkdirSync(bin); mkdirSync(cwd);
  const executable = join(bin, process.platform === "win32" ? "docker.exe" : "docker");
  writeFileSync(executable, "not executable test fixture", { mode: 0o755 });
  const calls = [], killed = [];
  const complete = (child, status = 0, stdout = "", stderr = "") => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end(); child.stderr.end(); child.emit("close", status, null);
  };
  t.mock.method(childProcess, "spawn", (command, args, options) => {
    assert.equal(command, executable, "The candidate cwd must not select the Docker executable");
    assert.equal(options.shell, false);
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.unref = () => {};
    child.kill = signal => {
      killed.push({ args, signal });
      if (!behavior.ignoreKill) globalThis.queueMicrotask(() => complete(child, null));
      return !behavior.ignoreKill;
    };
    globalThis.queueMicrotask(() => {
      if (args[0] === "run") {
        if (behavior.spawnError) { child.emit("error", Object.assign(Error("fixture unavailable"), { code: "ENOENT" })); return; }
        if (behavior.hang) return;
        complete(child, behavior.exitCode ?? 0, behavior.output ?? "check output", behavior.stderr ?? "");
      } else if (args[0] === "rm") {
        if (behavior.cleanupHang) return;
        complete(child, behavior.removalCode ?? 0, "", behavior.removalError ?? "");
      } else {
        assert.deepEqual(args.slice(0, 3), ["container", "ls", "--all"]);
        complete(child, behavior.inspectCode ?? 0, behavior.remaining ? "container-still-present\n" : "", behavior.inspectError ?? "");
      }
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.includes("goriq-container-boundary-"));
    rmSync(root, { recursive: true, force: true });
  });
  return { calls, killed, options: { cwd, env: { PATH: bin }, timeoutMs: 30,
    cleanupTimeoutMs: 30, killGraceMs: 10, maxBuffer: 128 } };
}
const runArgs = ["run", "--rm", "--network=none", "fixture@sha256:" + "a".repeat(64), "echo", "fixture"];

test("zero exit requires exact named-container cleanup and confirmed absence", async t => {
  const f = fixture(t), result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout, "check output");
  assert.equal(result.cleanup?.confirmed, true);
  const name = f.calls[0][f.calls[0].indexOf("--name") + 1];
  assert.match(name, /^goriq-verifier-[a-f0-9-]{36}$/);
  assert.deepEqual(f.calls[1], ["rm", "--force", "--volumes", name]);
  assert.ok(f.calls[2].includes(`name=^/${name}$`));
});

test("timeout kills the Docker CLI and cleans the container", async t => {
  const f = fixture(t, { hang: true });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.equal(result.cleanup?.confirmed, true);
  assert.equal(result.closeObserved, true);
  assert.equal(f.killed[0]?.signal, "SIGKILL");
  assert.equal(f.calls[1]?.[0], "rm");
});

test("a CLI that never closes remains cleanup-uncertain even after an empty listing", async t => {
  const f = fixture(t, { hang: true, ignoreKill: true });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.error?.code, "VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED");
  assert.equal(result.runErrorCode, "ETIMEDOUT");
  assert.equal(result.closeObserved, false);
  assert.equal(result.cleanup?.confirmed, false);
  assert.equal(result.cleanup?.inspection.status, 0);
  assert.equal(f.calls.length, 3);
});

test("combined output overflow is bounded and cannot become PASS", async t => {
  const f = fixture(t, { output: "x".repeat(100), stderr: "y".repeat(100) });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.error?.code, "ENOBUFS");
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 128);
  assert.equal(result.cleanup?.confirmed, true);
});

for (const [label, behavior] of [
  ["still present", { remaining: true }],
  ["daemon query fails", { inspectCode: 1, inspectError: "daemon unavailable" }],
  ["cleanup hangs", { cleanupHang: true, ignoreKill: true }],
]) {
  test(`successful check is inconclusive when cleanup ${label}`, async t => {
    const f = fixture(t, behavior), result = await runVerifierContainer(runArgs, f.options);
    assert.equal(result.status, 0);
    assert.equal(result.error?.code, "VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED");
    assert.equal(result.cleanup?.confirmed, false);
    assert.equal(f.calls.length, 3);
  });
}

test("a failed check preserves its logs and still removes the named container", async t => {
  const f = fixture(t, { exitCode: 2, output: "test failed", stderr: "assertion detail" });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "test failed");
  assert.equal(result.stderr, "assertion detail");
  assert.equal(result.cleanup?.confirmed, true);
});

test("spawn failure still reaches scoped cleanup and retains the failure code", async t => {
  const f = fixture(t, { spawnError: true });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.error?.code, "VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED");
  assert.equal(result.runErrorCode, "ENOENT");
  assert.equal(result.cleanup?.confirmed, false);
  assert.equal(f.calls.length, 3);
});

test("caller cannot replace the generated cleanup identity", async t => {
  const f = fixture(t);
  await assert.rejects(runVerifierContainer(["run", "--name=unrelated", "fixture"], f.options),
    /VERIFIER_CONTAINER_REQUEST_INVALID/);
  assert.equal(f.calls.length, 0);
});
