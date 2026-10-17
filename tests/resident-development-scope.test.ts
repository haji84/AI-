import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveResidentDevelopmentScope } from "../src/orchestrator/resident-development-scope.ts";

const resident = resolve(tmpdir(), "goriq-resident-main");
const isolated = resolve(tmpdir(), "goriq-owner-opt-in-candidate");
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
