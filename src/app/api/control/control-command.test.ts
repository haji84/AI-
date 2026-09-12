import assert from "node:assert/strict";
import test from "node:test";
import { commandFor, type ControlAction } from "./control-command.ts";

const actions: ControlAction[] = ["run", "resume", "pause", "status", "test", "preview"];

test("dashboard quick controls emit an allowed Chat command source", () => {
  for (const action of actions) {
    assert.equal(commandFor(action).source, "chat", `${action} must use the command ingress source contract`);
  }
});

test("run quick control keeps its bounded execution intent", () => {
  const command = commandFor("run");
  assert.equal(command.command, "次の安全な作業を進める");
  assert.equal(command.plan.kind, "run");
});
