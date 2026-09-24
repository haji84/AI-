import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

test("owner work intake schedules durable Goal execution outside the Broker event loop", () => {
  const broker = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");
  const executor = readFileSync(new URL("../scripts/jarvis-goal-executor.ts", import.meta.url), "utf8");
  assert.match(broker, /spawn\(process\.execPath/);
  assert.match(broker, /jarvis-goal-executor\.ts/);
  assert.match(broker, /scheduleGoalExecution\(decision,/);
  assert.match(broker, /executionScheduled/);
  assert.match(broker, /activeGoalExecutions/);
  assert.match(broker, /goalHint: requestedGoalHint \|\| activeGoal\?\.goalId/);
  assert.match(executor, /GoalControllerExecutionBridge/);
  assert.match(executor, /new CompassGoalExecutionAdapter\(compassPath\)/);
  assert.match(executor, /executeUntilGoalTerminal\(decision,/);
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
  const executor = readFileSync(new URL("../scripts/jarvis-goal-executor.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/jarvis/bridge/events/route.ts", import.meta.url), "utf8");
  assert.match(executor, /GOAL_COMPLETED/);
  assert.match(executor, /HUMAN_REQUIRED/);
  assert.match(executor, /GOAL_BLOCKED/);
  assert.match(broker, /bridge\/events\/ack/);
  assert.match(route, /requireJarvisOwner/);
  assert.match(route, /eventId/);
});
