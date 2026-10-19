import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { readResidentExecutionManifest } from "../src/orchestrator/resident-execution-manifest.ts";
import { residentDevelopmentGoalDigest } from "../src/orchestrator/resident-development-sequence.ts";
import { localOllamaFixtureSourcePath, localOllamaFixtureTestPath } from "../src/orchestrator/local-ollama-tdd.ts";

test("host-pinned manifest binds independent workspaces and receipt paths to an exact Goal", t => {
  const root = mkdtempSync(join(tmpdir(), "goriq-execution-manifest-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const paths = [join(root, "a"), join(root, "b")]; paths.forEach(path => mkdirSync(path));
  const goal = { title: "Implement local files", successCriteria: ["first exact artifact", "second exact artifact"], constraints: ["No publication"] };
  const sequence = { version: 1, goalDigest: residentDevelopmentGoalDigest(goal), taskScopeId: "issue:1219",
    maxRisk: "low", expiresAt: "2099-01-01T00:00:00.000Z", completionMode: "verified-local-artifact",
    jobs: ["a", "b"].map((key, i) => ({ key, objective: goal.successCriteria[i], criterionIds: [`criterion-${i + 1}`],
      targetFiles: [localOllamaFixtureSourcePath, localOllamaFixtureTestPath], baseRevision: "a".repeat(40) })) };
  const manifest = { version: 1, sequence, executions: ["a", "b"].map((key, i) => ({ key, workspace: paths[i],
    targetPath: localOllamaFixtureSourcePath, allowedFiles: [localOllamaFixtureSourcePath, localOllamaFixtureTestPath],
    receiptFile: join(root, `receipt-${key}.json`), publicKeyFile: join(root, "verifier.pub"), publicKeySha256: "b".repeat(64),
    tddProfile: "python_add_v1", acceptance: [{ criterionId: `criterion-${i + 1}`, description: goal.successCriteria[i],
      expectedFiles: [{ path: localOllamaFixtureSourcePath, sha256: "c".repeat(64) }] }] })) };
  const file = join(root, "manifest.json");
  const save = () => { const bytes = JSON.stringify(manifest); writeFileSync(file, bytes); return {
    GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE: file, GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256: createHash("sha256").update(bytes).digest("hex") }; };
  const env = save();
  assert.deepEqual(readResidentExecutionManifest(env, join(root, "runtime"), goal), manifest);
  assert.throws(() => readResidentExecutionManifest({ ...env, GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256: "f".repeat(64) }, root, goal), /MANIFEST_PIN/);
  assert.throws(() => readResidentExecutionManifest(env, root, { ...goal, successCriteria: ["different"] }), /[Gg]oal|GOAL|sequence/i);
  manifest.executions[1]!.workspace = paths[0];
  assert.throws(() => readResidentExecutionManifest(save(), root, goal), /WORKSPACE/);
  manifest.executions[1]!.workspace = paths[1];
  manifest.executions[1]!.receiptFile = manifest.executions[0]!.receiptFile;
  assert.throws(() => readResidentExecutionManifest(save(), root, goal), /RECEIPT/);
  manifest.executions[1]!.receiptFile = join(paths[0]!, "receipt.json");
  assert.throws(() => readResidentExecutionManifest(save(), root, goal), /AUTHORITY_INSIDE_CANDIDATE/);
  manifest.executions[1]!.receiptFile = manifest.executions[1]!.publicKeyFile;
  assert.throws(() => readResidentExecutionManifest(save(), join(root, "runtime"), goal), /AUTHORITY_OVERLAP/);
  manifest.executions[1]!.receiptFile = manifest.executions[0]!.receiptFile + ".request.json";
  assert.throws(() => readResidentExecutionManifest(save(), root, goal), /RECEIPT_OVERLAP/);
  manifest.executions[1]!.receiptFile = join(root, "receipt-b.json");
  manifest.executions[1]!.publicKeyFile = manifest.executions[0]!.receiptFile + ".request.json";
  assert.throws(() => readResidentExecutionManifest(save(), root, goal), /AUTHORITY_OVERLAP/);
});
