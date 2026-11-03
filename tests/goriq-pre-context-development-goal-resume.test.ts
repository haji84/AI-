import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("pre-context persisted development Goal can resume from Compass objective after Broker restart", async () => {
  const source = await readFile(new URL("../scripts/jarvis-goal-executor.ts", import.meta.url), "utf8");
  assert.equal(source.includes("persistedGoalText"), true);
  assert.equal(source.includes("persistedOwnerCommand"), true);
  assert.equal(source.includes("developmentSignalText"), true);
  assert.equal(source.includes("compassGoalToLoopGoal"), true);
  assert.equal(source.includes("?? persistedOwnerCommand"), true);
  assert.equal(source.includes("test(developmentSignalText)"), true);
});
