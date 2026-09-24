import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

test("owner work intake schedules durable Goal execution instead of only persisting the decision", () => {
  const source = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");
  assert.match(source, /GoalControllerExecutionBridge: Bridge/);\n  assert.match(source, /new Bridge\(new CompassGoalExecutionAdapter\(compassPath\)\)/);
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

test("GORIQ owner UI exposes bridged Goal status and evidence", () => {
  const board = readFileSync(new URL("../src/app/jarvis/tasks/TaskBoard.tsx", import.meta.url), "utf8");
  const status = readFileSync(new URL("../src/app/jarvis/tasks/GoalBridgeStatus.tsx", import.meta.url), "utf8");
  assert.match(board, /GoalBridgeStatus/);
  assert.match(status, /DIRECT GOAL BRIDGE/);
  assert.match(status, /\/api\/jarvis\/work\//);
  assert.match(status, /Evidence/);
  assert.match(status, /次の自律Action/);
  assert.match(status, /Recovery/);
});

test("GORIQ emits provider-neutral outbound events for chat clients", () => {
  const broker = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/jarvis/bridge/events/route.ts", import.meta.url), "utf8");
  assert.match(broker, /GOAL_COMPLETED/);
  assert.match(broker, /HUMAN_REQUIRED/);
  assert.match(broker, /GOAL_BLOCKED/);
  assert.match(broker, /bridge\/events\/ack/);
  assert.match(route, /requireJarvisOwner/);
  assert.match(route, /eventId/);
});
