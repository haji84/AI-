import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveResidentDevelopmentScope } from "../src/orchestrator/resident-development-scope.ts";

const root = mkdtempSync(join(tmpdir(), "goriq-scope-identity-"));
after(() => rmSync(root, { recursive: true, force: true }));
const resident = resolve(root, "resident");
const isolated = resolve(root, "isolated");
mkdirSync(resident);
mkdirSync(isolated);
const pinned = "tests/fixtures/local-goal-acceptance.py";
const local = {
  GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "1",
  GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: isolated,
  GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: pinned,
  GAI_LOCAL_MODEL_NAME: "qwen2.5-coder:3b",
  CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796",
  CODE_BUILDER_LOCAL_TOKEN: "unused",
};

test("default resident routing retains its prior target discovery and local flag", () => {
  assert.deepEqual(resolveResidentDevelopmentScope({}, resident,
    ["src/owner.ts"], ["src/owner.ts", "tests/owner.test.ts"]), {
    repositoryRoot: resident, targetFiles: ["src/owner.ts", "tests/owner.test.ts"],
    localOnly: false, localOllama: false,
  });
  assert.equal(resolveResidentDevelopmentScope({ GORIQ_SELF_DEVELOPMENT_LOCAL_ONLY: "1" }, resident, [], []).localOnly, true);
});

test("Codex-free opt-in pins its source root, exact target and local-only mode", () => {
  assert.deepEqual(resolveResidentDevelopmentScope(local, resident, [],
    ["src/private.ts", "scripts/trigger.ts"]), {
    repositoryRoot: isolated, targetFiles: [pinned], localOnly: true, localOllama: true,
  });
  assert.equal(resolveResidentDevelopmentScope({ ...local, GORIQ_SELF_DEVELOPMENT_TARGET_FILES: pinned }, resident, [pinned], []).localOnly, true);
});

test("local Goal refuses unpinned, conflicting, unsafe or broadened filesystem scope", () => {
  const run = (overrides: Record<string, string>, files: string[] = []) =>
    resolveResidentDevelopmentScope({ ...local, ...overrides }, resident, files, []);
  assert.throws(() => run({ GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: resident }), /distinct absolute/);
  assert.throws(() => run({ GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: "relative/candidate" }), /distinct absolute/);
  assert.throws(() => run({ GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: pinned + ",src/second.ts" }), /exactly one/);
  assert.throws(() => run({ GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: "../secret.txt" }), /exactly one/);
  assert.throws(() => run({ GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: "tests/../bad.py" }), /exactly one/);
  assert.throws(() => run({}, ["src/override.ts"]), /conflicts/);
  assert.throws(() => run({ GAI_LOCAL_MODEL_NAME: "" }), /named model/);
  assert.throws(() => run({ GORIQ_SELF_DEVELOPMENT_LOCAL_ONLY: "0" }), /local-only/);
  assert.throws(() => run({ GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "yes" }), /Invalid/);
});

test("Ollama mode never widens scope using unrelated Goal intake paths", () => {
  const result = resolveResidentDevelopmentScope(local, resident, [], [
    "src/orchestrator/runtime-builder-capability.ts",
    "scripts/jarvis-broker.ts",
    "docs/remote-instruction.md",
  ]);
  assert.deepEqual(result.targetFiles, [pinned]);
  assert.notEqual(result.repositoryRoot, resident);
});

test("local scope rejects a filesystem alias of the resident root", () => {
  const alias = join(root, "resident-alias");
  symlinkSync(resident, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => resolveResidentDevelopmentScope({ ...local,
    GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: alias }, resident, [], []), /distinct absolute/);
  if (process.platform === "win32") {
    assert.throws(() => resolveResidentDevelopmentScope({ ...local,
      GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: resident.toUpperCase() }, resident, [], []), /distinct absolute/);
  }
});

test("local scope refuses an absent or non-directory isolated root", () => {
  assert.throws(() => resolveResidentDevelopmentScope({ ...local,
    GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: join(root, "missing") }, resident, [], []), /existing isolated/);
  const file = join(root, "ordinary-file");
  writeFileSync(file, "fixture");
  assert.throws(() => resolveResidentDevelopmentScope({ ...local,
    GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: file }, resident, [], []), /existing isolated/);
});
