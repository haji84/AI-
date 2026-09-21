import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRuntimeBuilderPrPromotionCapability } from "../src/orchestrator/runtime-builder-pr-capability.ts";

const execFileAsync = promisify(execFile);

async function initRepo() {
  const dir = await mkdtemp(join(tmpdir(), "builder-pr-"));
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "example.ts"), "export const x = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: dir });
  return dir;
}

test("Builder PR promotion fails closed when there are no local changes", async () => {
  const cwd = await initRepo();
  const capability = createRuntimeBuilderPrPromotionCapability({ cwd });
  const result = await capability.execute({
    id: "p1", description: "promote", capability: "repository.promote_builder_changes", risk: "low",
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "builder_pr_promotion_failed");
  assert.match(result.summary, /no local Builder changes/);
});

test("Builder PR promotion rejects changes outside bounded scope", async () => {
  const cwd = await initRepo();
  await writeFile(join(cwd, "package.json"), "{\"private\":true}\n");
  const capability = createRuntimeBuilderPrPromotionCapability({ cwd });
  const result = await capability.execute({
    id: "p2", description: "promote", capability: "repository.promote_builder_changes", risk: "low",
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "builder_pr_promotion_failed");
  assert.match(result.summary, /outside bounded autonomous scope/);
});
