import assert from "node:assert/strict";
import test from "node:test";
import { buildRepositoryDevelopmentContext } from "../src/orchestrator/repository-development-context.ts";

test("repository context maps symbols, imports, tests, and requirement references", () => {
  const context = buildRepositoryDevelopmentContext({
    objective: "Change GoalRunner for CORE-014",
    preferredFiles: ["src/goal-runner.ts"],
    maxChars: 2_000,
    entries: [
      { path: "src/goal-runner.ts", content: 'import { verify } from "./verify.ts";\nexport class GoalRunner { run() { return verify(); } }\n// CORE-014' },
      { path: "src/verify.ts", content: "export function verify() { return true; }" },
      { path: "tests/goal-runner.test.ts", content: 'import { GoalRunner } from "../src/goal-runner.ts";\nnew GoalRunner().run();' },
      { path: "docs/unrelated.md", content: "unrelated" },
    ],
  });
  assert.deepEqual(context.selectedPaths, ["src/goal-runner.ts", "src/verify.ts", "tests/goal-runner.test.ts"]);
  assert.ok(context.symbols.includes("GoalRunner"));
  assert.ok(context.symbols.includes("verify"));
  assert.deepEqual(context.requirementIds, ["CORE-014"]);
  assert.deepEqual(context.relatedTests, ["tests/goal-runner.test.ts"]);
  assert.equal(context.truncated, false);
});

test("repository context is bounded and does not ingest unrelated files", () => {
  const context = buildRepositoryDevelopmentContext({
    objective: "Change src/a.ts",
    preferredFiles: ["src/a.ts"],
    maxChars: 120,
    entries: [
      { path: "src/a.ts", content: `export const a = "${"x".repeat(500)}";` },
      { path: "src/b.ts", content: `export const b = "${"y".repeat(500)}";` },
      { path: "docs/large.md", content: "z".repeat(1_000) },
    ],
  });
  assert.deepEqual(context.selectedPaths, ["src/a.ts"]);
  assert.equal(context.truncated, true);
  assert.ok(context.items.reduce((total, item) => total + item.summary.length, 0) <= 120);
});

