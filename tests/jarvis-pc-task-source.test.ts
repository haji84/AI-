import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as bootstrap from "../src/jarvis/pc-bootstrap.ts";
test("PC work input is bound to a clean exact revision and committed public blob", () => {
  assert.equal(typeof bootstrap.readCommittedPcWorkInput, "function", "exact source guard is required");
  const root = mkdtempSync(join(tmpdir(), "pc-source-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init"); git("config", "user.name", "source-fixture"); git("config", "user.email", "fixture@example.invalid");
    mkdirSync(join(root, "docs", "architecture"), { recursive: true });
    const path = join(root, "docs", "architecture", "goriq-distributed-node-fabric.md");
    writeFileSync(path, "committed public specification\n");
    writeFileSync(join(root, "executor.ts"), "export const unchanged = true;\n");
    git("add", "."); git("commit", "-m", "fixture");
    const revision = git("rev-parse", "HEAD");
    assert.equal(bootstrap.readCommittedPcWorkInput(revision, root), "committed public specification\n");
    assert.throws(() => bootstrap.readCommittedPcWorkInput("f".repeat(40), root), /SOURCE/);
    writeFileSync(path, "dirty input\n");
    assert.throws(() => bootstrap.readCommittedPcWorkInput(revision, root), /SOURCE/);
    git("restore", "--", "docs/architecture/goriq-distributed-node-fabric.md");
    writeFileSync(join(root, "executor.ts"), "export const changed = true;\n");
    assert.throws(() => bootstrap.readCommittedPcWorkInput(revision, root), /SOURCE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
