import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceWaitError } from "../src/gai/development-resource-admission.ts";
import {
  assertRepairAdapterResult,
  attemptRepairEngineCandidate,
} from "../scripts/goriq-pr-ci-recovery.ts";

const outcome = {
  status: "WAITING_FOR_RESOURCE" as const,
  reason: "heavy execution lane unavailable",
  retryAfterMs: 30000,
  observedAt: "2026-10-21T12:00:00.000Z",
};

test("repair CLI resource deferral becomes a typed wait instead of a failed repair", () => {
  const stderr = JSON.stringify({ ok: false, blocker: "WAITING_FOR_RESOURCE", resourceWait: outcome });
  assert.throws(() => assertRepairAdapterResult("goriq-ollama-repair.mjs", {
    status: 75, stdout: "", stderr,
  }), (error: unknown) => {
    assert.ok(error instanceof ResourceWaitError);
    assert.deepEqual(error.outcome, outcome);
    return true;
  });
});

test("malformed exit75 and normal repair errors do not become successful waits", () => {
  for (const stderr of [
    "not JSON",
    JSON.stringify({ ok: true, blocker: "WAITING_FOR_RESOURCE", resourceWait: outcome }),
    JSON.stringify({ ok: false, blocker: "WAITING_FOR_RESOURCE", resourceWait: { ...outcome, retryAfterMs: -1 } }),
    JSON.stringify({ ok: false, blocker: "WAITING_FOR_RESOURCE", resourceWait: { ...outcome, retryAfterMs: 86400000 } }),
    JSON.stringify({ ok: false, blocker: "WAITING_FOR_RESOURCE", resourceWait: { ...outcome, observedAt: "bad time" } }),
  ]) {
    assert.throws(() => assertRepairAdapterResult("repair.mjs", { status: 75, stdout: "", stderr }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof ResourceWaitError, false);
      return true;
    });
  }
  assert.throws(() => assertRepairAdapterResult("repair.mjs", { status: 3, stdout: "", stderr: "repair failed" }), /repair failed/);
});

test("candidate resource wait escapes failure escalation and preserves its candidate without verification or commit", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "goriq-recovery-wait-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const git = (args: string[]) => execFileSync("git", args, { cwd: workspace, encoding: "utf8", windowsHide: true }).trim();
  git(["init", "--quiet"]);
  git(["config", "user.name", "GORIQ test"]);
  git(["config", "user.email", "test@local.invalid"]);
  await writeFile(join(workspace, "candidate.txt"), "before");
  git(["add", "candidate.txt"]);
  git(["commit", "--quiet", "-m", "baseline"]);
  const originalHead = git(["rev-parse", "HEAD"]);
  let calls = 0;
  const wait = new ResourceWaitError(outcome);
  assert.throws(() => attemptRepairEngineCandidate({
    runner: { id: "goriq-local-code", run() {
      calls += 1;
      writeFileSync(join(workspace, "candidate.txt"), "preserved candidate");
      throw wait;
    } },
    workspace, initialPrompt: "bounded fixture", prNumber: 1845, strategy: 1,
    allowedPaths: ["candidate.txt"], originalFailureFingerprint: "1234567890abcdef",
  }), (error: unknown) => error === wait);
  assert.equal(calls, 1);
  assert.equal(await readFile(join(workspace, "candidate.txt"), "utf8"), "preserved candidate");
  assert.equal(git(["rev-parse", "HEAD"]), originalHead);
  assert.equal(git(["log", "--format=%s", "-1"]), "baseline");
});
