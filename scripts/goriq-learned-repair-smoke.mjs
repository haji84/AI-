#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  applyLearnedMemory,
  persistLearnedMemory,
} from "./goriq-pr-ci-recovery.ts";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || result.stdout).slice(-2000)}`);
  }
  return String(result.stdout ?? "").trim();
}

const root = mkdtempSync(join(tmpdir(), "goriq-learned-repair-smoke-"));
const workspace = join(root, "repo");
const memoryRoot = join(root, "memory");
const fingerprint = "0123456789abcdef";

try {
  mkdirSync(workspace, { recursive: true });
  git(workspace, ["init"]);
  git(workspace, ["config", "user.name", "goriq-smoke"]);
  git(workspace, ["config", "user.email", "smoke@localhost"]);
  writeFileSync(join(workspace, "probe.txt"), "BEFORE", "utf8");
  git(workspace, ["add", "probe.txt"]);
  git(workspace, ["commit", "-m", "baseline"]);

  process.env.GORIQ_REPAIR_MEMORY_ROOT = memoryRoot;
  writeFileSync(join(workspace, "probe.txt"), "AFTER", "utf8");
  persistLearnedMemory(workspace, fingerprint, ["probe.txt"], "goriq-local-code");

  git(workspace, ["reset", "--hard", "HEAD"]);
  const applied = applyLearnedMemory(workspace, fingerprint, ["probe.txt"]);
  const actual = readFileSync(join(workspace, "probe.txt"), "utf8");

  if (!applied) throw new Error("LEARNED_REPAIR_SMOKE_REPLAY_NOT_APPLIED");
  if (actual !== "AFTER") throw new Error(`LEARNED_REPAIR_SMOKE_MISMATCH: ${actual}`);

  process.stdout.write(JSON.stringify({
    ok: true,
    fingerprint,
    actual,
    memoryRoot,
  }, null, 2) + "\n");
} finally {
  delete process.env.GORIQ_REPAIR_MEMORY_ROOT;
  rmSync(root, { recursive: true, force: true });
}
