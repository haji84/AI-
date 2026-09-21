import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = new URL("../scripts/runtime-builder-daily-smoke.ts", import.meta.url);

test("daily runtime Builder smoke tests normal completion, not forced recovery", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /complete content is exactly runtime-daily/);
  assert.match(source, /report\.stopReason === "goal_complete"/);
  assert.match(source, /report\.goalEvaluation\?\.achieved === true/);
  assert.doesNotMatch(source, /runtime-wrong/);
  assert.doesNotMatch(source, /strategy_pivot/);
  assert.doesNotMatch(source, /recoveryAction/);
});
