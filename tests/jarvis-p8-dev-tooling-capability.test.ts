import assert from "node:assert/strict";
import test from "node:test";
import {
  createMacbookWorkerAdapter,
  createZbookWorkerAdapter,
} from "../src/gai/initial-worker-adapters.ts";
import {
  createDevelopmentToolingCapabilityHandler,
  type DevelopmentToolingBridge,
} from "../src/gai/development-tooling-capability.ts";

const task = {
  id: "dev-tooling-task",
  title: "development tooling",
  description: "exercise bounded development tooling",
  difficulty: 5,
  risk: "LOW" as const,
  requiresFrontierReasoning: false,
  requiresLongContext: false,
};

function handler(bridge: DevelopmentToolingBridge, overrides: Partial<Parameters<typeof createDevelopmentToolingCapabilityHandler>[0]> = {}) {
  return createDevelopmentToolingCapabilityHandler({
    bridge,
    allowedOperations: ["lint", "test", "typecheck", "build"],
    allowedWorkspaces: ["ai-repo"],
    allowedTargets: ["unit", "app"],
    ...overrides,
  });
}

test("ZBook and MacBook execute only structured development operations through injected bridges", async () => {
  const seen: unknown[] = [];
  const windowsBridge: DevelopmentToolingBridge = {
    platform: "windows",
    async execute(request) {
      seen.push(request);
      return { ok: true, status: "PASS", exitCode: 0, checkIds: ["lint-check"] };
    },
  };
  const macBridge: DevelopmentToolingBridge = {
    platform: "macos",
    async execute(request) {
      seen.push(request);
      return { ok: true, status: "PASS", exitCode: 0, artifactRefs: ["build-artifact"] };
    },
  };
  const zbook = createZbookWorkerAdapter({ handlers: { "windows-tooling": handler(windowsBridge) } });
  const macbook = createMacbookWorkerAdapter({ handlers: { "macos-tooling": handler(macBridge) } });

  const lint = await zbook.execute({
    task,
    input: JSON.stringify({ operation: "lint", workspace: "ai-repo", target: "app" }),
    requestedCapability: "windows-tooling",
  });
  const build = await macbook.execute({
    task,
    input: JSON.stringify({ operation: "build", workspace: "ai-repo" }),
    requestedCapability: "macos-tooling",
  });

  assert.equal(lint.ok, true);
  assert.equal(build.ok, true);
  assert.deepEqual(seen, [
    { taskId: task.id, operation: "lint", workspace: "ai-repo", target: "app" },
    { taskId: task.id, operation: "build", workspace: "ai-repo" },
  ]);
  assert.deepEqual(lint.evidence?.capabilityEvidence, {
    developmentTooling: {
      platform: "windows",
      operation: "lint",
      workspace: "ai-repo",
      target: "app",
      status: "PASS",
      exitCode: 0,
      checkIds: ["lint-check"],
      artifactRefs: [],
    },
  });
});

test("development tooling rejects arbitrary command surfaces and unapproved scope before bridge execution", async () => {
  let calls = 0;
  const bridge: DevelopmentToolingBridge = {
    platform: "windows",
    async execute() {
      calls += 1;
      return { ok: true, status: "PASS" };
    },
  };
  const zbook = createZbookWorkerAdapter({ handlers: { "windows-tooling": handler(bridge, { allowedOperations: ["test"] }) } });
  const cases = [
    { operation: "test", workspace: "ai-repo", command: "rm -rf /" },
    { operation: "lint", workspace: "ai-repo" },
    { operation: "test", workspace: "other-repo" },
    { operation: "test", workspace: "ai-repo", target: "release" },
    { operation: "test", workspace: "../ai-repo" },
  ];

  for (const input of cases) {
    const result = await zbook.execute({ task, input: JSON.stringify(input), requestedCapability: "windows-tooling" });
    assert.equal(result.ok, false);
  }
  assert.equal(calls, 0);
});

test("development tooling fails closed on platform mismatch and bridge failure", async () => {
  let calls = 0;
  const wrongPlatform: DevelopmentToolingBridge = {
    platform: "macos",
    async execute() {
      calls += 1;
      return { ok: true, status: "PASS" };
    },
  };
  const zbookMismatch = createZbookWorkerAdapter({ handlers: { "windows-tooling": handler(wrongPlatform) } });
  const mismatch = await zbookMismatch.execute({
    task,
    input: JSON.stringify({ operation: "test", workspace: "ai-repo" }),
    requestedCapability: "windows-tooling",
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.output, /platform_capability_mismatch/);
  assert.equal(calls, 0);

  const failing: DevelopmentToolingBridge = {
    platform: "windows",
    async execute() {
      return { ok: false, status: "TEST_FAILED", exitCode: 1 };
    },
  };
  const zbook = createZbookWorkerAdapter({ handlers: { "windows-tooling": handler(failing) } });
  const failed = await zbook.execute({
    task,
    input: JSON.stringify({ operation: "test", workspace: "ai-repo", target: "unit" }),
    requestedCapability: "windows-tooling",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.output, "development_tooling_failed:TEST_FAILED");
});

test("development tooling rejects unsafe bridge evidence instead of persisting free-form data", async () => {
  const bridge: DevelopmentToolingBridge = {
    platform: "windows",
    async execute() {
      return { ok: true, status: "PASS", checkIds: ["token=secret value"] };
    },
  };
  const zbook = createZbookWorkerAdapter({ handlers: { "windows-tooling": handler(bridge) } });
  const result = await zbook.execute({
    task,
    input: JSON.stringify({ operation: "test", workspace: "ai-repo" }),
    requestedCapability: "windows-tooling",
  });
  assert.equal(result.ok, false);
  assert.equal(result.output, "development_tooling_invalid_check_id");
  assert.equal(JSON.stringify(result.evidence).includes("secret value"), false);
});
