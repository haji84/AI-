import assert from "node:assert/strict";
import test from "node:test";
import { LocalDevelopmentBuilder } from "../src/orchestrator/local-development-builder.ts";

test("local Builder returns the shared bounded Change Set envelope", async () => {
  const builder = new LocalDevelopmentBuilder({
    id: "zbook-local",
    workspaceRoot: "/workspace/repository",
    async run(input) {
      assert.equal(input.attemptId, "attempt-local");
      assert.equal(input.workspaceRoot, "/workspace/repository");
      return {
        ok: true,
        summary: "local model completed",
        changedPaths: ["src/local.ts"],
        patchDigest: "e".repeat(64),
      };
    },
  });
  assert.equal(builder.kind, "local");
  assert.equal(await builder.available(), true);
  const result = await builder.build({
    goalId: "goal-681",
    attemptId: "attempt-local",
    strategyId: "local-strategy",
    objective: "change local file",
    files: ["src/local.ts"],
    context: [],
    baseRevision: "f".repeat(40),
    localOnly: true,
  });
  assert.equal(result.ok, true);
  const evidence = result.evidence as { changeSet?: { builderId?: string; builderKind?: string } };
  assert.equal(evidence.changeSet?.builderId, "zbook-local");
  assert.equal(evidence.changeSet?.builderKind, "local");
});

test("local Builder fails closed when its engine is unavailable", async () => {
  const builder = new LocalDevelopmentBuilder({
    id: "mac-local",
    workspaceRoot: "/workspace/repository",
    available: async () => false,
    async run() { throw new Error("must not run"); },
  });
  assert.equal(await builder.available(), false);
  const result = await builder.build({
    goalId: "goal-681",
    attemptId: "attempt-unavailable",
    strategyId: "local-strategy",
    objective: "change local file",
    files: ["src/local.ts"],
    context: [],
    baseRevision: "f".repeat(40),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "local_builder_unavailable");
});

