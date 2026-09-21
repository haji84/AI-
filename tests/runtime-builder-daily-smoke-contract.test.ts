import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = new URL("../scripts/runtime-builder-daily-smoke.ts", import.meta.url);

test("daily runtime Builder smoke proves independent verifier recovery", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /source: "development\.verification_contract"/);
  assert.match(source, /expected: "runtime-daily"/);
  assert.match(source, /complete content is runtime-wrong/);
  assert.match(source, /firstCycle\?\.verification\?\.ok === false/);
  assert.match(source, /recoveryDecision\?\.action === "strategy_pivot"/);
  assert.match(source, /successfulCycle\?\.verification\?\.ok === true/);
  assert.match(source, /report\.stopReason === "goal_complete"/);
  assert.match(source, /report\.goalEvaluation\?\.achieved === true/);
  assert.doesNotMatch(source, /description:.*runtime-daily/);
  assert.doesNotMatch(source, /successCriteria:.*runtime-daily/);
});
