import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

test("owner work intake schedules durable Goal execution instead of only persisting the decision", () => {
  const source = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");
  assert.match(source, /new GoalControllerExecutionBridge\(new CompassGoalExecutionAdapter\(compassPath\)\)/);
  assert.match(source, /scheduleGoalExecution\(decision,/);
  assert.match(source, /executeUntilGoalTerminal\(decision,/);
  assert.match(source, /executionScheduled/);
  assert.match(source, /goalHint: requestedGoalHint \|\| activeGoal\?\.goalId/);
});

test("public owner work route forwards an explicit goal hint without weakening owner auth", () => {
  const source = readFileSync(new URL("../src/app/api/jarvis/work/route.ts", import.meta.url), "utf8");
  assert.match(source, /requireJarvisOwner\(\)/);
  assert.match(source, /goalHint/);
  assert.match(source, /jarvisBrokerFetch\("\/api\/jarvis\/admin\/work"/);
});
